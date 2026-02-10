#!/bin/bash
#
# 任务队列管理辅助函数
#

# 获取任务队列统计
get_task_stats() {
    local queue_file="$1"

    if [ ! -f "$queue_file" ]; then
        echo "0 0 0 0 0"
        return
    fi

    local total=$(grep -c "^### \[" "$queue_file" 2>/dev/null || echo "0")
    local pending=$(grep -c "^### \[pending\]" "$queue_file" 2>/dev/null || echo "0")
    local in_progress=$(grep -c "^### \[in_progress\]" "$queue_file" 2>/dev/null || echo "0")
    local completed=$(grep -c "^### \[completed\]" "$queue_file" 2>/dev/null || echo "0")
    local failed=$(grep -c "^### \[failed\]" "$queue_file" 2>/dev/null || echo "0")

    echo "$total $pending $in_progress $completed $failed"
}

# 更新统计信息
update_task_stats() {
    local queue_file="$1"
    local stats=$(get_task_stats "$queue_file")
    read total pending in_progress completed failed <<< "$stats"

    # 更新统计部分
    sed -i '' "/^## 📊 统计信息/,/^---/ {
        s/- \*\*总任务数\*\*:.*/- **总任务数**: $total/
        s/- \*\*待完成\*\*.*/- **待完成** (pending): $pending/
        s/- \*\*进行中\*\*.*/- **进行中** (in_progress): $in_progress/
        s/- \*\*已完成\*\*.*/- **已完成** (completed): $completed/
        s/- \*\*失败\*\*.*/- **失败** (failed): $failed/
    }" "$queue_file"

    # 更新最后更新时间
    sed -i '' "s/\*\*最后更新\*\*:.*/\*\*最后更新\*\*: $(date '+%Y-%m-%d %H:%M:%S')/" "$queue_file"
}

# 获取下一个待执行任务
get_next_task() {
    local queue_file="$1"

    if [ ! -f "$queue_file" ]; then
        echo ""
        return 1
    fi

    # 查找第一个 [pending] 任务
    local task_line=$(grep -n "^### \[pending\]" "$queue_file" | head -1 | cut -d: -f1)

    if [ -z "$task_line" ]; then
        echo ""
        return 1
    fi

    # 提取任务内容（从 ### [pending] 到下一个 ### 或文件末尾）
    local next_task_line=$(tail -n +$((task_line + 1)) "$queue_file" | grep -n "^### \[" | head -1 | cut -d: -f1)

    if [ -n "$next_task_line" ]; then
        # 有下一个任务，提取到下一个任务之前
        sed -n "${task_line},$((task_line + next_task_line - 1))p" "$queue_file"
    else
        # 没有下一个任务，提取到文件末尾
        sed -n "${task_line},\$p" "$queue_file"
    fi
}

# 标记任务为进行中
mark_task_in_progress() {
    local queue_file="$1"
    local task_id="$2"

    # 将第一个 [pending] 改为 [in_progress]
    sed -i '' "0,/^### \[pending\]/{s/^### \[pending\]/### [in_progress]/}" "$queue_file"

    update_task_stats "$queue_file"
}

# 标记任务为已完成
mark_task_completed() {
    local queue_file="$1"
    local task_id="$2"

    # 将 [in_progress] 改为 [completed]，并添加完成时间
    sed -i '' "/^### \[in_progress\]/,/^### \[/ {
        s/^### \[in_progress\]/### [completed]/
        s/\*\*完成时间\*\*: -.*/\*\*完成时间\*\*: $(date '+%Y-%m-%d %H:%M:%S')/
    }" "$queue_file"

    update_task_stats "$queue_file"
}

# 标记任务为失败
mark_task_failed() {
    local queue_file="$1"
    local task_id="$2"
    local error_msg="$3"

    # 将 [in_progress] 改为 [failed]
    sed -i '' "/^### \[in_progress\]/,/^### \[/ {
        s/^### \[in_progress\]/### [failed]/
        s/\*\*完成时间\*\*: -.*/\*\*失败时间\*\*: $(date '+%Y-%m-%d %H:%M:%S')/
    }" "$queue_file"

    update_task_stats "$queue_file"
}

# 添加新任务到队列
add_tasks_to_queue() {
    local queue_file="$1"
    local tasks_content="$2"

    # 在任务列表部分添加新任务
    # 查找 "## 📋 任务列表" 后的位置
    local insert_line=$(grep -n "^## 📋 任务列表" "$queue_file" | cut -d: -f1)

    if [ -n "$insert_line" ]; then
        # 在任务列表后插入新任务
        local temp_file=$(mktemp)
        head -n $((insert_line + 2)) "$queue_file" > "$temp_file"
        echo "$tasks_content" >> "$temp_file"
        echo "" >> "$temp_file"
        tail -n +$((insert_line + 3)) "$queue_file" >> "$temp_file"
        mv "$temp_file" "$queue_file"
    fi

    update_task_stats "$queue_file"
}
