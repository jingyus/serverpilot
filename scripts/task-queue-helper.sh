#!/bin/bash
#
# 任务队列管理辅助函数
#
# 设计原则:
# - TASK_QUEUE.md 是唯一数据源（失败次数、失败原因都内嵌在任务块中）
# - 不依赖外部状态文件，脚本重启不丢失数据
# - 使用 awk 替代 sed，兼容 macOS BSD sed 和 Linux GNU sed
#

# 获取任务队列统计
get_task_stats() {
    local queue_file="$1"

    if [ ! -f "$queue_file" ]; then
        echo "0 0 0 0 0"
        return
    fi

    local total=$(grep -c "^### \[" "$queue_file" 2>/dev/null || true)
    local pending=$(grep -c "^### \[pending\]" "$queue_file" 2>/dev/null || true)
    local in_progress=$(grep -c "^### \[in_progress\]" "$queue_file" 2>/dev/null || true)
    local completed=$(grep -c "^### \[completed\]" "$queue_file" 2>/dev/null || true)
    local failed=$(grep -c "^### \[failed\]" "$queue_file" 2>/dev/null || true)

    total="${total:-0}"
    pending="${pending:-0}"
    in_progress="${in_progress:-0}"
    completed="${completed:-0}"
    failed="${failed:-0}"

    echo "$total $pending $in_progress $completed $failed"
}

# 更新统计信息
update_task_stats() {
    local queue_file="$1"
    local stats=$(get_task_stats "$queue_file")
    read total pending in_progress completed failed <<< "$stats"

    awk -v total="$total" -v pending="$pending" -v in_progress="$in_progress" \
        -v completed="$completed" -v failed="$failed" '
        /^- \*\*总任务数\*\*:/ { $0 = "- **总任务数**: " total }
        /^- \*\*待完成\*\*/ { $0 = "- **待完成** (pending): " pending }
        /^- \*\*进行中\*\*/ { $0 = "- **进行中** (in_progress): " in_progress }
        /^- \*\*已完成\*\*/ { $0 = "- **已完成** (completed): " completed }
        /^- \*\*失败\*\*/ { $0 = "- **失败** (failed): " failed }
        { print }
    ' "$queue_file" > "${queue_file}.tmp" && mv "${queue_file}.tmp" "$queue_file"

    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    awk -v ts="$timestamp" '
        /^\*\*最后更新\*\*:/ { $0 = "**最后更新**: " ts }
        { print }
    ' "$queue_file" > "${queue_file}.tmp" && mv "${queue_file}.tmp" "$queue_file"
}

# 提取任务块内容（从指定行到下一个任务头或使用说明段落）
_extract_task_block() {
    local queue_file="$1"
    local task_line="$2"

    local next_task_line=$(tail -n +$((task_line + 1)) "$queue_file" | grep -n "^### \[" | head -1 | cut -d: -f1)

    if [ -n "$next_task_line" ]; then
        sed -n "${task_line},$((task_line + next_task_line - 1))p" "$queue_file"
    else
        tail -n +${task_line} "$queue_file" | awk '/^## 使用说明/ { exit } { print }'
    fi
}

# 从任务内容中提取 task ID
_extract_task_id() {
    local task_content="$1"
    echo "$task_content" | grep '\*\*ID\*\*:' | head -1 | sed 's/.*\*\*ID\*\*:[[:space:]]*//' | xargs
}

# =====================================================
# 失败计数函数（从 TASK_QUEUE.md 内嵌字段读写）
# =====================================================

# 从 TASK_QUEUE.md 中读取指定任务的失败次数
get_failure_count() {
    local task_id="$1"
    local queue_file="${2:-${TASK_QUEUE:-}}"

    if [ -z "$task_id" ] || [ -z "$queue_file" ] || [ ! -f "$queue_file" ]; then
        echo "0"
        return
    fi

    # 找到 task_id 所在块，提取 **失败次数**: N
    local count=$(awk -v id="$task_id" '
        $0 ~ "\\*\\*ID\\*\\*:.*" id { found_id = 1; next }
        found_id && /\*\*失败次数\*\*:/ {
            s = $0
            gsub(/[^0-9]/, "", s)
            print s
            exit
        }
        found_id && /^### \[/ { print "0"; exit }
    ' "$queue_file")

    echo "${count:-0}"
}

# =====================================================
# 获取下一个待执行任务
# =====================================================

get_next_task() {
    local queue_file="$1"
    local max_failures="${2:-0}"  # 0 = 不过滤

    if [ ! -f "$queue_file" ]; then
        echo ""
        return 1
    fi

    # 使用 while read + process substitution 兼容 bash/zsh
    while IFS= read -r task_line; do
        local task_content=$(_extract_task_block "$queue_file" "$task_line")

        if [ -z "$task_content" ]; then
            continue
        fi

        # 失败次数过滤
        if [ "$max_failures" -gt 0 ]; then
            local task_id=$(_extract_task_id "$task_content")
            local failure_count=$(get_failure_count "$task_id" "$queue_file")
            if [ "$failure_count" -ge "$max_failures" ]; then
                # 超限 → 标记为 [failed]
                if [ -n "$task_id" ]; then
                    _force_mark_task_failed_by_line "$queue_file" "$task_line" "超过最大失败次数 ($failure_count/$max_failures)"
                fi
                continue
            fi
        fi

        echo "$task_content"
        return 0
    done < <(grep -n "^### \[pending\]" "$queue_file" | cut -d: -f1)

    return 1
}

# 强制标记指定行的任务为失败（通过行号）
_force_mark_task_failed_by_line() {
    local queue_file="$1"
    local line_num="$2"
    local error_msg="$3"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')

    awk -v line="$line_num" -v ts="$timestamp" '
        NR == line && /^### \[pending\]/ {
            sub(/\[pending\]/, "[failed]")
        }
        { print }
    ' "$queue_file" > "${queue_file}.tmp" && mv "${queue_file}.tmp" "$queue_file"

    update_task_stats "$queue_file"
}

# =====================================================
# 标记任务状态
# =====================================================

# 标记任务为进行中（按 task_id 精确定位）
mark_task_in_progress() {
    local queue_file="$1"
    local task_id="$2"

    if [ -n "$task_id" ]; then
        awk -v id="$task_id" '
            BEGIN { found=0; pending_line=0; buf_count=0 }

            /^### \[pending\]/ && !found {
                if (pending_line > 0) {
                    print pending_text
                    for (i = 1; i <= buf_count; i++) print buf[i]
                }
                pending_line = NR
                pending_text = $0
                buf_count = 0
                delete buf
                next
            }

            pending_line > 0 && !found {
                if ($0 ~ "\\*\\*ID\\*\\*:.*" id) {
                    gsub(/\[pending\]/, "[in_progress]", pending_text)
                    print pending_text
                    for (i = 1; i <= buf_count; i++) print buf[i]
                    print
                    found = 1
                    pending_line = 0
                    next
                } else if (/^### \[/) {
                    print pending_text
                    for (i = 1; i <= buf_count; i++) print buf[i]
                    if (/^### \[pending\]/) {
                        pending_line = NR
                        pending_text = $0
                        buf_count = 0
                        delete buf
                    } else {
                        pending_line = 0
                        print
                    }
                    next
                } else {
                    buf_count++
                    buf[buf_count] = $0
                    next
                }
            }

            { print }

            END {
                if (pending_line > 0) {
                    if (!found) print pending_text
                    else {
                        gsub(/\[pending\]/, "[in_progress]", pending_text)
                        print pending_text
                    }
                    for (i = 1; i <= buf_count; i++) print buf[i]
                }
            }
        ' "$queue_file" > "${queue_file}.tmp" && mv "${queue_file}.tmp" "$queue_file"
    else
        awk '
            /^### \[pending\]/ && !found { sub(/\[pending\]/, "[in_progress]"); found=1 }
            { print }
        ' "$queue_file" > "${queue_file}.tmp" && mv "${queue_file}.tmp" "$queue_file"
    fi

    if ! grep -q "^### \[in_progress\]" "$queue_file"; then
        echo "[WARN] mark_task_in_progress: 未能成功标记任务" >&2
        return 1
    fi

    update_task_stats "$queue_file"
    return 0
}

# 标记任务为已完成
mark_task_completed() {
    local queue_file="$1"
    local task_id="$2"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')

    awk -v ts="$timestamp" '
        /^### \[in_progress\]/ && !found {
            sub(/\[in_progress\]/, "[completed]")
            if ($0 !~ /✅/) $0 = $0 " ✅"
            found = 1
            in_block = 1
            print
            next
        }

        in_block && /\*\*完成时间\*\*: -/ {
            sub(/\*\*完成时间\*\*: -.*/, "**完成时间**: " ts)
        }

        in_block && /^### \[/ { in_block = 0 }

        { print }
    ' "$queue_file" > "${queue_file}.tmp" && mv "${queue_file}.tmp" "$queue_file"

    update_task_stats "$queue_file"
}

# 标记任务为失败（同时内嵌失败次数和失败原因到任务块中）
mark_task_failed() {
    local queue_file="$1"
    local task_id="$2"
    local error_msg="$3"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')

    awk -v ts="$timestamp" -v err="$error_msg" '
        /^### \[in_progress\]/ && !found {
            sub(/\[in_progress\]/, "[failed]")
            found = 1
            in_block = 1
            has_fail_count = 0
            has_fail_reason = 0
            has_fail_time = 0
            print
            next
        }

        # 更新完成时间 → 失败时间
        in_block && /\*\*完成时间\*\*: -/ {
            $0 = "**失败时间**: " ts
            has_fail_time = 1
        }

        # 已有失败时间字段 → 更新
        in_block && /\*\*失败时间\*\*:/ && !has_fail_time {
            $0 = "**失败时间**: " ts
            has_fail_time = 1
        }

        # 已有失败次数 → 递增
        in_block && /\*\*失败次数\*\*:/ {
            s = $0
            gsub(/[^0-9]/, "", s)
            old_count = s + 0
            $0 = "**失败次数**: " (old_count + 1)
            has_fail_count = 1
        }

        # 已有失败原因 → 更新
        in_block && /\*\*失败原因\*\*:/ {
            if (err != "") $0 = "**失败原因**: " err
            has_fail_reason = 1
        }

        # 遇到分隔线或下一个任务头 → 在此之前插入缺失字段
        in_block && (/^---$/ || /^### \[/) {
            if (!has_fail_count) print "**失败次数**: 1"
            if (!has_fail_reason && err != "") print "**失败原因**: " err
            in_block = 0
        }

        { print }

        # 如果到文件末尾还在块内，补充缺失字段
        END {
            if (in_block) {
                if (!has_fail_count) print "**失败次数**: 1"
                if (!has_fail_reason && err != "") print "**失败原因**: " err
            }
        }
    ' "$queue_file" > "${queue_file}.tmp" && mv "${queue_file}.tmp" "$queue_file"

    update_task_stats "$queue_file"
}

# =====================================================
# 失败任务重试与重置
# =====================================================

# 自动重试：将失败次数未超限的 [failed] 任务改回 [pending]
# 返回重试的任务数
retry_eligible_failed_tasks() {
    local queue_file="$1"
    local max_failures="${2:-3}"

    local retried=$(awk -v max="$max_failures" '
        BEGIN { count = 0 }

        /^### \[failed\]/ {
            in_block = 1
            heading = $0
            fail_count = 0
            buf_count = 0
            delete buf
            next
        }

        in_block && /\*\*失败次数\*\*:/ {
            s = $0
            gsub(/[^0-9]/, "", s)
            fail_count = s + 0
            buf_count++
            buf[buf_count] = $0
            next
        }

        in_block && (/^---$/ || /^### \[/) {
            if (fail_count < max) {
                gsub(/\[failed\]/, "[pending]", heading)
                count++
            }
            print heading
            for (i = 1; i <= buf_count; i++) print buf[i]
            in_block = 0
        }

        in_block {
            buf_count++
            buf[buf_count] = $0
            next
        }

        { print }

        END {
            if (in_block) {
                if (fail_count < max) {
                    gsub(/\[failed\]/, "[pending]", heading)
                    count++
                }
                print heading
                for (i = 1; i <= buf_count; i++) print buf[i]
            }
            # 输出重试数量到 stderr
            print count > "/dev/stderr"
        }
    ' "$queue_file" 2>&1 1>"${queue_file}.tmp")

    mv "${queue_file}.tmp" "$queue_file"
    update_task_stats "$queue_file"

    echo "${retried:-0}"
}

# 计算可重试的失败任务数
count_retryable_failed_tasks() {
    local queue_file="$1"
    local max_failures="${2:-3}"

    if [ ! -f "$queue_file" ]; then
        echo "0"
        return
    fi

    awk -v max="$max_failures" '
        /^### \[failed\]/ { in_block = 1; fail_count = 0; next }
        in_block && /\*\*失败次数\*\*:/ {
            s = $0
            gsub(/[^0-9]/, "", s)
            fail_count = s + 0
        }
        in_block && (/^---$/ || /^### \[/) {
            if (fail_count < max) retryable++
            in_block = 0
        }
        END {
            if (in_block && fail_count < max) retryable++
            print retryable + 0
        }
    ' "$queue_file"
}

# 强制重置所有失败任务为 pending（手动操作，清零失败次数）
reset_failed_tasks() {
    local queue_file="$1"

    awk '{
        if (/^### \[failed\]/) {
            sub(/\[failed\]/, "[pending]")
        }
        # 清零失败次数
        if (/^\*\*失败次数\*\*:/) {
            $0 = "**失败次数**: 0"
        }
        print
    }' "$queue_file" > "${queue_file}.tmp" && mv "${queue_file}.tmp" "$queue_file"

    update_task_stats "$queue_file"
}

# 显示失败任务摘要（从 TASK_QUEUE.md 读取）
show_failure_summary() {
    local queue_file="${1:-${TASK_QUEUE:-}}"

    if [ -z "$queue_file" ] || [ ! -f "$queue_file" ]; then
        echo "没有任务队列文件"
        return
    fi

    local has_failed=$(grep -c "^### \[failed\]" "$queue_file" 2>/dev/null || true)
    if [ "${has_failed:-0}" -eq 0 ]; then
        echo "没有失败的任务"
        return
    fi

    echo "=== 失败任务统计 ==="
    awk '
        /^### \[failed\]/ {
            title = $0
            sub(/^### \[failed\] /, "", title)
            in_block = 1
            task_id = ""
            fail_count = "?"
            fail_reason = ""
            next
        }
        in_block && /\*\*ID\*\*:/ {
            s = $0
            sub(/.*\*\*ID\*\*:[[:space:]]*/, "", s)
            task_id = s
        }
        in_block && /\*\*失败次数\*\*:/ {
            s = $0
            gsub(/[^0-9]/, "", s)
            fail_count = s
        }
        in_block && /\*\*失败原因\*\*:/ {
            s = $0
            sub(/.*\*\*失败原因\*\*:[[:space:]]*/, "", s)
            fail_reason = s
        }
        in_block && (/^---$/ || /^### \[/) {
            printf "  %s (%s): 失败 %s 次", title, task_id, fail_count
            if (fail_reason != "") printf " [%s]", fail_reason
            printf "\n"
            in_block = 0
        }
        END {
            if (in_block) {
                printf "  %s (%s): 失败 %s 次", title, task_id, fail_count
                if (fail_reason != "") printf " [%s]", fail_reason
                printf "\n"
            }
        }
    ' "$queue_file"
    echo "===================="
}

# =====================================================
# 添加新任务到队列
# =====================================================

add_tasks_to_queue() {
    local queue_file="$1"
    local tasks_content="$2"

    local insert_line=$(grep -n "^## 📋 任务列表" "$queue_file" | cut -d: -f1)

    if [ -n "$insert_line" ]; then
        local temp_file=$(mktemp)
        head -n $((insert_line + 2)) "$queue_file" > "$temp_file"
        echo "$tasks_content" >> "$temp_file"
        echo "" >> "$temp_file"
        tail -n +$((insert_line + 3)) "$queue_file" >> "$temp_file"
        mv "$temp_file" "$queue_file"
    fi

    update_task_stats "$queue_file"
}
