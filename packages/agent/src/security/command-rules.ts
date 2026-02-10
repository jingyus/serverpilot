/**
 * Command classification rule definitions for ServerPilot Agent.
 * Contains pattern rules for five-level command risk classification.
 * @module security/command-rules
 */

export interface PatternRule {
  pattern: RegExp;
  reason: string;
}

// FORBIDDEN patterns — absolutely prohibited commands
export const FORBIDDEN_PATTERNS: PatternRule[] = [
  // Recursive deletion of root or entire filesystem
  { pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|(-[a-zA-Z]*f[a-zA-Z]*r))\s+\/(\s|$|\*)/, reason: 'Recursive deletion of root filesystem' },
  { pattern: /\brm\s+--no-preserve-root/, reason: 'Deletion with --no-preserve-root' },
  // Disk formatting
  { pattern: /\bmkfs\b/, reason: 'Disk formatting command' },
  { pattern: /\bfdisk\b/, reason: 'Disk partitioning command' },
  { pattern: /\bparted\b/, reason: 'Disk partitioning command (parted)' },
  { pattern: /\bgdisk\b/, reason: 'GPT disk partitioning command' },
  // Device overwriting
  { pattern: /\bdd\s+.*if=\/dev\/zero/, reason: 'Device overwriting with /dev/zero' },
  { pattern: /\bdd\s+.*of=\/dev\/sd/, reason: 'Direct writing to block device' },
  { pattern: /\bdd\s+.*of=\/dev\/nvme/, reason: 'Direct writing to NVMe device' },
  { pattern: /\bdd\s+.*of=\/dev\/vd/, reason: 'Direct writing to virtual device' },
  // Fork bomb
  { pattern: /:\(\)\s*\{[^}]*:\|:/, reason: 'Fork bomb detected' },
  { pattern: /\.\/fork_bomb|fork_bomb\.sh/, reason: 'Fork bomb script' },
  // Writing to block devices
  { pattern: />\s*\/dev\/sd[a-z]/, reason: 'Direct writing to block device' },
  { pattern: />\s*\/dev\/nvme/, reason: 'Direct writing to NVMe device' },
  // Recursive chmod 777 on root
  { pattern: /\bchmod\s+(-[a-zA-Z]*R[a-zA-Z]*\s+)?777\s+\/(\s|$)/, reason: 'Recursive chmod 777 on root' },
  // Destructive kernel/system operations
  { pattern: /\bsysctl\s+-w\s+kernel\.panic/, reason: 'Kernel panic manipulation' },
  // Network interface destruction
  { pattern: /\bip\s+link\s+delete\s/, reason: 'Network interface deletion' },
  // Wiping utilities
  { pattern: /\bwipefs\s/, reason: 'Filesystem signature wipe' },
  { pattern: /\bblkdiscard\s/, reason: 'Block device discard' },
  // Kernel module manipulation
  { pattern: /\binsmod\s/, reason: 'Kernel module insertion' },
  { pattern: /\brmmod\s/, reason: 'Kernel module removal' },
  // System halt/poweroff from script context
  { pattern: /\binit\s+0\b/, reason: 'System halt via init' },
  // Reverse shell patterns
  { pattern: /\bbash\s+-i\s+>(&|&>)\s*\/dev\/tcp\//, reason: 'Reverse shell attempt (bash /dev/tcp)' },
  { pattern: /\bnc\s+.*-e\s+\/bin\/(ba)?sh/, reason: 'Reverse shell attempt (netcat)' },
  { pattern: /\bncat\s+.*-e\s+\/bin\/(ba)?sh/, reason: 'Reverse shell attempt (ncat)' },
  { pattern: /\bsocat\s+.*EXEC:/, reason: 'Reverse shell attempt (socat)' },
  // Crypto mining
  { pattern: /\bxmrig\b/, reason: 'Cryptocurrency miner detected' },
  { pattern: /\bminerd\b/, reason: 'Cryptocurrency miner detected' },
  { pattern: /stratum\+tcp:\/\//, reason: 'Mining pool connection detected' },
  // SELinux/AppArmor disabling
  { pattern: /\bsetenforce\s+0/, reason: 'SELinux enforcement disabled' },
  { pattern: /\baa-teardown\b/, reason: 'AppArmor teardown' },
  // Swap/memory destruction
  { pattern: /\bswapoff\s+-a/, reason: 'Disabling all swap partitions' },
  // History tampering
  { pattern: /\bhistory\s+-c\b/, reason: 'Shell history clearing (tampering)' },
  { pattern: />\s*~?\/?\.bash_history/, reason: 'Bash history file overwrite' },
  // Cloud infrastructure mass destruction
  { pattern: /\baws\s+ec2\s+terminate-instances\b.*--instance-ids\s+\S+\s+\S+/, reason: 'AWS mass instance termination' },
  { pattern: /\baws\s+s3\s+rb\s+.*--force/, reason: 'AWS S3 bucket force removal' },
  { pattern: /\bgcloud\s+projects\s+delete\b/, reason: 'GCP project deletion' },
  { pattern: /\baz\s+group\s+delete\b/, reason: 'Azure resource group deletion' },
  // Virtualization destruction
  { pattern: /\bvirsh\s+destroy\s/, reason: 'VM forced destruction (virsh)' },
  { pattern: /\bvirsh\s+undefine\s/, reason: 'VM definition removal (virsh)' },
  // Encryption ransomware patterns
  { pattern: /\bopenssl\s+enc\s+.*-e\s+.*-in\s+\//, reason: 'Bulk file encryption on system paths' },
  // cgroup/namespace abuse
  { pattern: /\bnsenter\s+.*--target\s+1\b/, reason: 'Container escape via nsenter to PID 1' },
  // iptables flush (firewall wipe)
  { pattern: /\biptables\s+-F(\s|$)/, reason: 'Firewall rules flush (iptables)' },
  { pattern: /\biptables\s+--flush(\s|$)/, reason: 'Firewall rules flush (iptables)' },
  // Cgroup resource exhaustion
  { pattern: /\bcgdelete\b/, reason: 'Cgroup deletion' },
  // GRUB bootloader overwrite
  { pattern: /\bgrub-install\b/, reason: 'GRUB bootloader installation (can brick system)' },
  // Systemd mask of critical services
  { pattern: /\bsystemctl\s+mask\s+(networking|network|sshd|systemd-journald)/, reason: 'Masking critical system service' },
];

// CRITICAL patterns — destructive commands
export const CRITICAL_PATTERNS: PatternRule[] = [
  // File deletion
  { pattern: /\brm\s+/, reason: 'File deletion command' },
  { pattern: /\brmdir\s+/, reason: 'Directory removal command' },
  { pattern: /\bshred\s+/, reason: 'Secure file deletion (shred)' },
  { pattern: /\bunlink\s+/, reason: 'File unlink command' },
  // Package removal
  { pattern: /\bapt\s+(remove|purge|autoremove)\s/, reason: 'Package removal command (apt)' },
  { pattern: /\bapt-get\s+(remove|purge|autoremove)\s/, reason: 'Package removal command (apt-get)' },
  { pattern: /\byum\s+(remove|erase)\s/, reason: 'Package removal command (yum)' },
  { pattern: /\bdnf\s+(remove|erase|autoremove)\s/, reason: 'Package removal command (dnf)' },
  { pattern: /\bpacman\s+-R/, reason: 'Package removal command (pacman)' },
  { pattern: /\bbrew\s+uninstall\s/, reason: 'Package removal command (brew)' },
  { pattern: /\bsnap\s+remove\s/, reason: 'Snap package removal' },
  // Node.js package removal
  { pattern: /\bnpm\s+uninstall\s/, reason: 'NPM package removal' },
  { pattern: /\bnpm\s+remove\s/, reason: 'NPM package removal' },
  { pattern: /\bpnpm\s+remove\s/, reason: 'PNPM package removal' },
  { pattern: /\byarn\s+remove\s/, reason: 'Yarn package removal' },
  { pattern: /\bpip\s+uninstall\s/, reason: 'Python package removal' },
  { pattern: /\bpip3\s+uninstall\s/, reason: 'Python package removal' },
  // Container/image deletion
  { pattern: /\bdocker\s+(rm|rmi)\s/, reason: 'Docker container/image deletion' },
  { pattern: /\bdocker\s+container\s+rm\s/, reason: 'Docker container deletion' },
  { pattern: /\bdocker\s+image\s+rm\s/, reason: 'Docker image deletion' },
  { pattern: /\bdocker\s+system\s+prune/, reason: 'Docker system prune' },
  { pattern: /\bdocker\s+volume\s+rm\s/, reason: 'Docker volume deletion' },
  { pattern: /\bdocker\s+network\s+rm\s/, reason: 'Docker network deletion' },
  { pattern: /\bdocker\s+volume\s+prune/, reason: 'Docker volume prune' },
  { pattern: /\bdocker\s+image\s+prune/, reason: 'Docker image prune' },
  { pattern: /\bdocker\s+container\s+prune/, reason: 'Docker container prune' },
  // Database destruction
  { pattern: /\bDROP\s+(DATABASE|TABLE|INDEX|VIEW|SCHEMA)\b/i, reason: 'Database object deletion (DROP)' },
  { pattern: /\bTRUNCATE\s+/i, reason: 'Table truncation' },
  { pattern: /\bDELETE\s+FROM\s+/i, reason: 'Data deletion query' },
  { pattern: /\bALTER\s+TABLE\s+.*DROP\s+/i, reason: 'Column/constraint deletion' },
  // Dangerous file operations
  { pattern: /\bmv\s+\/etc\//, reason: 'Moving system configuration files' },
  { pattern: /\bmv\s+\/boot\//, reason: 'Moving boot files' },
  { pattern: /\bmv\s+\/usr\//, reason: 'Moving system program files' },
  // User/group management
  { pattern: /\buserdel\s/, reason: 'User deletion' },
  { pattern: /\bgroupdel\s/, reason: 'Group deletion' },
  // System service deletion
  { pattern: /\bsystemctl\s+mask\s/, reason: 'Service masking (prevents start)' },
  // Database admin
  { pattern: /\bmysqladmin\s+.*drop\b/i, reason: 'MySQL database deletion' },
  { pattern: /\bdropdb\s/, reason: 'PostgreSQL database deletion' },
  { pattern: /\bdropuser\s/, reason: 'PostgreSQL user deletion' },
  // Kubernetes destructive
  { pattern: /\bkubectl\s+delete\s/, reason: 'Kubernetes resource deletion' },
  // LVM destructive
  { pattern: /\blvremove\s/, reason: 'LVM logical volume removal' },
  { pattern: /\bvgremove\s/, reason: 'LVM volume group removal' },
  { pattern: /\bpvremove\s/, reason: 'LVM physical volume removal' },
  // System shutdown/reboot
  { pattern: /\bshutdown\s/, reason: 'System shutdown command' },
  { pattern: /\breboot\b/, reason: 'System reboot command' },
  { pattern: /\bpoweroff\b/, reason: 'System poweroff command' },
  { pattern: /\bhalt\b/, reason: 'System halt command' },
  // SSH key / credential deletion
  { pattern: /\brm\s+.*\.ssh\//, reason: 'SSH key deletion' },
  { pattern: /\brm\s+.*\.gnupg\//, reason: 'GPG key deletion' },
  // Filesystem unmount forced
  { pattern: /\bumount\s+.*-f\s/, reason: 'Forced filesystem unmount' },
  { pattern: /\bumount\s+-l\s/, reason: 'Lazy filesystem unmount' },
  // Truncate files to zero
  { pattern: /\btruncate\s/, reason: 'File truncation command' },
  // Terraform destroy
  { pattern: /\bterraform\s+destroy\b/, reason: 'Terraform infrastructure destruction' },
  // Ansible destructive
  { pattern: /\bansible\b.*\bshell\b.*\brm\b/, reason: 'Ansible shell rm command' },
  // Git force push
  { pattern: /\bgit\s+push\s+.*--force/, reason: 'Git force push (destructive)' },
  { pattern: /\bgit\s+push\s+-f\b/, reason: 'Git force push (destructive)' },
  // Database backup deletion
  { pattern: /\brm\s+.*\.sql(\.gz)?(\s|$)/, reason: 'Database backup file deletion' },
  // Cloud resource deletion
  { pattern: /\baws\s+ec2\s+terminate-instances\b/, reason: 'AWS EC2 instance termination' },
  { pattern: /\baws\s+rds\s+delete-db-instance\b/, reason: 'AWS RDS instance deletion' },
  { pattern: /\baws\s+s3\s+rm\s/, reason: 'AWS S3 object deletion' },
  { pattern: /\bgcloud\s+compute\s+instances\s+delete\b/, reason: 'GCP instance deletion' },
  { pattern: /\bgcloud\s+sql\s+instances\s+delete\b/, reason: 'GCP SQL instance deletion' },
  { pattern: /\baz\s+vm\s+delete\b/, reason: 'Azure VM deletion' },
  { pattern: /\baz\s+sql\s+server\s+delete\b/, reason: 'Azure SQL server deletion' },
  // Redis destructive operations
  { pattern: /\bredis-cli\s+.*FLUSHALL\b/i, reason: 'Redis flush all databases' },
  { pattern: /\bredis-cli\s+.*FLUSHDB\b/i, reason: 'Redis flush current database' },
  // Podman destructive (like Docker)
  { pattern: /\bpodman\s+(rm|rmi)\s/, reason: 'Podman container/image deletion' },
  { pattern: /\bpodman\s+system\s+prune/, reason: 'Podman system prune' },
  // RAID destruction
  { pattern: /\bmdadm\s+--stop\s/, reason: 'RAID array stop' },
  { pattern: /\bmdadm\s+--remove\s/, reason: 'RAID device removal' },
  // Certificate revocation
  { pattern: /\bcertbot\s+revoke\b/, reason: 'SSL certificate revocation' },
  // Vault secrets deletion
  { pattern: /\bvault\s+kv\s+delete\s/, reason: 'HashiCorp Vault secret deletion' },
  { pattern: /\bvault\s+secrets\s+disable\s/, reason: 'Vault secrets engine disable' },
  // Systemd journal vacuum
  { pattern: /\bjournalctl\s+--vacuum/, reason: 'Journal log vacuum (data removal)' },
  // Docker Swarm destructive
  { pattern: /\bdocker\s+service\s+rm\s/, reason: 'Docker Swarm service removal' },
  { pattern: /\bdocker\s+stack\s+rm\s/, reason: 'Docker Swarm stack removal' },
  { pattern: /\bdocker\s+secret\s+rm\s/, reason: 'Docker secret removal' },
  { pattern: /\bdocker\s+config\s+rm\s/, reason: 'Docker config removal' },
  // Cargo/Rust uninstall
  { pattern: /\bcargo\s+uninstall\s/, reason: 'Rust package removal' },
  // Go clean
  { pattern: /\bgo\s+clean\s+-cache/, reason: 'Go module cache deletion' },
  // Git branch deletion
  { pattern: /\bgit\s+branch\s+-[dD]\s/, reason: 'Git branch deletion' },
  { pattern: /\bgit\s+branch\s+--delete\s/, reason: 'Git branch deletion' },
  // Git tag deletion
  { pattern: /\bgit\s+tag\s+-d\s/, reason: 'Git tag deletion' },
  // Snap remove (already present but adding flatpak)
  { pattern: /\bflatpak\s+uninstall\s/, reason: 'Flatpak package removal' },
  // Nix garbage collection
  { pattern: /\bnix-collect-garbage\b/, reason: 'Nix store garbage collection' },
  // MongoDB destructive
  { pattern: /\bmongo(sh)?\s+.*db\.dropDatabase/, reason: 'MongoDB database drop' },
  { pattern: /\bmongo(sh)?\s+.*\.drop\(\)/, reason: 'MongoDB collection drop' },
  // Elasticsearch destructive
  { pattern: /\bcurl\s+.*-X\s+DELETE\s+.*localhost:9200/, reason: 'Elasticsearch index deletion' },
  // AWS additional destructive
  { pattern: /\baws\s+iam\s+delete-user\b/, reason: 'AWS IAM user deletion' },
  { pattern: /\baws\s+iam\s+delete-role\b/, reason: 'AWS IAM role deletion' },
  { pattern: /\baws\s+lambda\s+delete-function\b/, reason: 'AWS Lambda function deletion' },
  { pattern: /\baws\s+ecs\s+delete-cluster\b/, reason: 'AWS ECS cluster deletion' },
  // Docker network prune
  { pattern: /\bdocker\s+network\s+prune/, reason: 'Docker network prune' },
  // Git reset --hard
  { pattern: /\bgit\s+reset\s+--hard/, reason: 'Git hard reset (destructive)' },
  // Database GRANT/REVOKE (privilege modification)
  { pattern: /\bREVOKE\s+/i, reason: 'Database privilege revocation' },
];

// GREEN patterns — read-only commands, safe to auto-execute
export const GREEN_PATTERNS: PatternRule[] = [
  // File listing and viewing
  { pattern: /^\s*ls(\s|$)/, reason: 'File listing (read-only)' },
  { pattern: /^\s*cat\s/, reason: 'File content display (read-only)' },
  { pattern: /^\s*head(\s|$)/, reason: 'File head display (read-only)' },
  { pattern: /^\s*tail(\s|$)/, reason: 'File tail display (read-only)' },
  { pattern: /^\s*less(\s|$)/, reason: 'File pager (read-only)' },
  { pattern: /^\s*more(\s|$)/, reason: 'File pager (read-only)' },
  { pattern: /^\s*wc(\s|$)/, reason: 'Word count (read-only)' },
  { pattern: /^\s*file(\s|$)/, reason: 'File type detection (read-only)' },
  { pattern: /^\s*stat(\s|$)/, reason: 'File statistics (read-only)' },
  { pattern: /^\s*md5sum(\s|$)/, reason: 'MD5 checksum (read-only)' },
  { pattern: /^\s*sha256sum(\s|$)/, reason: 'SHA256 checksum (read-only)' },
  { pattern: /^\s*sha1sum(\s|$)/, reason: 'SHA1 checksum (read-only)' },
  { pattern: /^\s*cksum(\s|$)/, reason: 'Checksum (read-only)' },
  { pattern: /^\s*diff(\s|$)/, reason: 'File diff (read-only)' },
  { pattern: /^\s*tree(\s|$)/, reason: 'Directory tree (read-only)' },
  { pattern: /^\s*readlink(\s|$)/, reason: 'Symlink target (read-only)' },
  { pattern: /^\s*realpath(\s|$)/, reason: 'Canonical path (read-only)' },
  { pattern: /^\s*basename(\s|$)/, reason: 'Filename extraction (read-only)' },
  { pattern: /^\s*dirname(\s|$)/, reason: 'Directory name extraction (read-only)' },
  // System information
  { pattern: /^\s*df(\s|$)/, reason: 'Disk space display (read-only)' },
  { pattern: /^\s*free(\s|$)/, reason: 'Memory usage display (read-only)' },
  { pattern: /^\s*top\b/, reason: 'Process monitoring (read-only)' },
  { pattern: /^\s*htop\b/, reason: 'Process monitoring (read-only)' },
  { pattern: /^\s*ps(\s|$)/, reason: 'Process list (read-only)' },
  { pattern: /^\s*uptime(\s|$)/, reason: 'System uptime (read-only)' },
  { pattern: /^\s*uname(\s|$)/, reason: 'System info (read-only)' },
  { pattern: /^\s*hostname(\s|$)/, reason: 'Hostname display (read-only)' },
  { pattern: /^\s*whoami(\s|$)/, reason: 'Current user (read-only)' },
  { pattern: /^\s*id(\s|$)/, reason: 'User identity (read-only)' },
  { pattern: /^\s*date(\s|$)/, reason: 'Date display (read-only)' },
  { pattern: /^\s*lsb_release(\s|$)/, reason: 'OS release info (read-only)' },
  { pattern: /^\s*arch(\s|$)/, reason: 'Architecture display (read-only)' },
  { pattern: /^\s*nproc(\s|$)/, reason: 'CPU count (read-only)' },
  { pattern: /^\s*lscpu(\s|$)/, reason: 'CPU info (read-only)' },
  { pattern: /^\s*lsmem(\s|$)/, reason: 'Memory info (read-only)' },
  { pattern: /^\s*lspci(\s|$)/, reason: 'PCI devices (read-only)' },
  { pattern: /^\s*lsusb(\s|$)/, reason: 'USB devices (read-only)' },
  { pattern: /^\s*lsof(\s|$)/, reason: 'Open files (read-only)' },
  { pattern: /^\s*vmstat(\s|$)/, reason: 'Virtual memory stats (read-only)' },
  { pattern: /^\s*iostat(\s|$)/, reason: 'I/O statistics (read-only)' },
  { pattern: /^\s*mpstat(\s|$)/, reason: 'CPU statistics (read-only)' },
  { pattern: /^\s*sar(\s|$)/, reason: 'System activity (read-only)' },
  { pattern: /^\s*dmesg(\s|$)/, reason: 'Kernel messages (read-only)' },
  { pattern: /^\s*last(\s|$)/, reason: 'Login history (read-only)' },
  { pattern: /^\s*lastlog(\s|$)/, reason: 'Last login (read-only)' },
  { pattern: /^\s*w(\s|$)/, reason: 'Logged-in users (read-only)' },
  { pattern: /^\s*users(\s|$)/, reason: 'Logged-in users list (read-only)' },
  { pattern: /^\s*groups(\s|$)/, reason: 'User groups (read-only)' },
  { pattern: /^\s*getent(\s|$)/, reason: 'Database entries (read-only)' },
  // Network diagnostics
  { pattern: /^\s*ping(\s|$)/, reason: 'Network ping (read-only)' },
  { pattern: /^\s*ping6(\s|$)/, reason: 'IPv6 network ping (read-only)' },
  { pattern: /^\s*traceroute(\s|$)/, reason: 'Network trace (read-only)' },
  { pattern: /^\s*tracepath(\s|$)/, reason: 'Network path trace (read-only)' },
  { pattern: /^\s*dig(\s|$)/, reason: 'DNS query (read-only)' },
  { pattern: /^\s*nslookup(\s|$)/, reason: 'DNS lookup (read-only)' },
  { pattern: /^\s*host(\s|$)/, reason: 'DNS lookup (read-only)' },
  { pattern: /^\s*netstat(\s|$)/, reason: 'Network statistics (read-only)' },
  { pattern: /^\s*ss(\s|$)/, reason: 'Socket statistics (read-only)' },
  { pattern: /^\s*ifconfig(\s|$)/, reason: 'Network interfaces (read-only)' },
  { pattern: /^\s*ip\s+(addr|link|neigh)\s+(show|list)\b/, reason: 'Network info (read-only)' },
  { pattern: /^\s*ip\s+(addr|link|neigh)\s*$/, reason: 'Network info display (read-only)' },
  { pattern: /^\s*ip\s+(addr|link|neigh)\s+-/, reason: 'Network info with flags (read-only)' },
  { pattern: /^\s*ip\s+route\s+(show|list|get)\b/, reason: 'IP route info (read-only)' },
  { pattern: /^\s*ip\s+route\s*$/, reason: 'IP route display (read-only)' },
  { pattern: /^\s*ip\s+route\s+-/, reason: 'IP route display with flags (read-only)' },
  { pattern: /^\s*arp(\s|$)/, reason: 'ARP table (read-only)' },
  { pattern: /^\s*ethtool(\s|$)/, reason: 'Ethernet device info (read-only)' },
  { pattern: /^\s*mtr(\s|$)/, reason: 'Network diagnostic (read-only)' },
  { pattern: /^\s*nmap\s/, reason: 'Network scan (read-only)' },
  // Service status queries
  { pattern: /^\s*systemctl\s+status(\s|$)/, reason: 'Service status query (read-only)' },
  { pattern: /^\s*systemctl\s+is-active(\s|$)/, reason: 'Service active check (read-only)' },
  { pattern: /^\s*systemctl\s+is-enabled(\s|$)/, reason: 'Service enabled check (read-only)' },
  { pattern: /^\s*systemctl\s+list-units(\s|$)/, reason: 'Service list (read-only)' },
  { pattern: /^\s*systemctl\s+list-timers(\s|$)/, reason: 'Timer list (read-only)' },
  { pattern: /^\s*systemctl\s+show(\s|$)/, reason: 'Service properties (read-only)' },
  { pattern: /^\s*service\s+\S+\s+status(\s|$)/, reason: 'Service status query (read-only)' },
  { pattern: /^\s*journalctl(\s|$)/, reason: 'Journal logs (read-only)' },
  // Docker read-only queries
  { pattern: /^\s*docker\s+ps(\s|$)/, reason: 'Docker container list (read-only)' },
  { pattern: /^\s*docker\s+images(\s|$)/, reason: 'Docker image list (read-only)' },
  { pattern: /^\s*docker\s+logs(\s|$)/, reason: 'Docker logs (read-only)' },
  { pattern: /^\s*docker\s+inspect(\s|$)/, reason: 'Docker inspect (read-only)' },
  { pattern: /^\s*docker\s+info(\s|$)/, reason: 'Docker info (read-only)' },
  { pattern: /^\s*docker\s+version(\s|$)/, reason: 'Docker version (read-only)' },
  { pattern: /^\s*docker\s+stats(\s|$)/, reason: 'Docker stats (read-only)' },
  { pattern: /^\s*docker\s+top(\s|$)/, reason: 'Docker container top (read-only)' },
  { pattern: /^\s*docker\s+port(\s|$)/, reason: 'Docker port mappings (read-only)' },
  { pattern: /^\s*docker\s+diff(\s|$)/, reason: 'Docker filesystem diff (read-only)' },
  { pattern: /^\s*docker\s+network\s+ls(\s|$)/, reason: 'Docker network list (read-only)' },
  { pattern: /^\s*docker\s+volume\s+ls(\s|$)/, reason: 'Docker volume list (read-only)' },
  { pattern: /^\s*docker\s+compose\s+ps(\s|$)/, reason: 'Docker Compose container list (read-only)' },
  { pattern: /^\s*docker\s+compose\s+logs(\s|$)/, reason: 'Docker Compose logs (read-only)' },
  { pattern: /^\s*docker\s+compose\s+config(\s|$)/, reason: 'Docker Compose config (read-only)' },
  // Kubernetes read-only
  { pattern: /^\s*kubectl\s+get(\s|$)/, reason: 'Kubernetes resource list (read-only)' },
  { pattern: /^\s*kubectl\s+describe(\s|$)/, reason: 'Kubernetes resource describe (read-only)' },
  { pattern: /^\s*kubectl\s+logs(\s|$)/, reason: 'Kubernetes pod logs (read-only)' },
  { pattern: /^\s*kubectl\s+top(\s|$)/, reason: 'Kubernetes resource usage (read-only)' },
  { pattern: /^\s*kubectl\s+cluster-info(\s|$)/, reason: 'Kubernetes cluster info (read-only)' },
  // Nginx testing
  { pattern: /^\s*nginx\s+-t(\s|$)/, reason: 'Nginx config test (read-only)' },
  { pattern: /^\s*nginx\s+-T(\s|$)/, reason: 'Nginx config dump (read-only)' },
  // Apache testing
  { pattern: /^\s*apachectl\s+-t(\s|$)/, reason: 'Apache config test (read-only)' },
  { pattern: /^\s*httpd\s+-t(\s|$)/, reason: 'Apache config test (read-only)' },
  // Search/find (read-only)
  { pattern: /^\s*find\s/, reason: 'File search (read-only)' },
  { pattern: /^\s*grep(\s|$)/, reason: 'Text search (read-only)' },
  { pattern: /^\s*egrep(\s|$)/, reason: 'Extended regex search (read-only)' },
  { pattern: /^\s*fgrep(\s|$)/, reason: 'Fixed string search (read-only)' },
  { pattern: /^\s*rg(\s|$)/, reason: 'Ripgrep search (read-only)' },
  { pattern: /^\s*ag(\s|$)/, reason: 'Silver searcher (read-only)' },
  { pattern: /^\s*which(\s|$)/, reason: 'Command lookup (read-only)' },
  { pattern: /^\s*whereis(\s|$)/, reason: 'Command lookup (read-only)' },
  { pattern: /^\s*locate(\s|$)/, reason: 'File search (read-only)' },
  { pattern: /^\s*type(\s|$)/, reason: 'Command type (read-only)' },
  // Version checks
  { pattern: /^\s*\S+\s+--version(\s|$)/, reason: 'Version check (read-only)' },
  { pattern: /^\s*\S+\s+-v(\s|$)/, reason: 'Version check (read-only)' },
  { pattern: /^\s*\S+\s+-V(\s|$)/, reason: 'Version check (read-only)' },
  { pattern: /^\s*node\s+--version/, reason: 'Node.js version (read-only)' },
  // Environment
  { pattern: /^\s*printenv(\s|$)/, reason: 'Environment variables (read-only)' },
  { pattern: /^\s*env(\s|$)/, reason: 'Environment variables (read-only)' },
  { pattern: /^\s*echo(\s|$)/, reason: 'Echo output (read-only)' },
  { pattern: /^\s*printf(\s|$)/, reason: 'Printf output (read-only)' },
  // Package query
  { pattern: /^\s*apt\s+list(\s|$)/, reason: 'Package list (read-only)' },
  { pattern: /^\s*apt\s+show(\s|$)/, reason: 'Package info (read-only)' },
  { pattern: /^\s*apt\s+search(\s|$)/, reason: 'Package search (read-only)' },
  { pattern: /^\s*apt-cache\s+(search|show|showpkg|depends|rdepends|policy)(\s|$)/, reason: 'Package cache query (read-only)' },
  { pattern: /^\s*dpkg\s+-l(\s|$)/, reason: 'Package list (read-only)' },
  { pattern: /^\s*dpkg\s+--list(\s|$)/, reason: 'Package list (read-only)' },
  { pattern: /^\s*dpkg\s+-s(\s|$)/, reason: 'Package status (read-only)' },
  { pattern: /^\s*dpkg\s+-L(\s|$)/, reason: 'Package files (read-only)' },
  { pattern: /^\s*rpm\s+-q/, reason: 'Package query (read-only)' },
  { pattern: /^\s*yum\s+(list|info|search)(\s|$)/, reason: 'Yum package query (read-only)' },
  { pattern: /^\s*dnf\s+(list|info|search)(\s|$)/, reason: 'DNF package query (read-only)' },
  { pattern: /^\s*snap\s+list(\s|$)/, reason: 'Snap package list (read-only)' },
  { pattern: /^\s*brew\s+(list|info|search)(\s|$)/, reason: 'Brew package query (read-only)' },
  // Disk / mount info
  { pattern: /^\s*lsblk(\s|$)/, reason: 'Block device list (read-only)' },
  { pattern: /^\s*mount(\s|$)/, reason: 'Mount points display (read-only)' },
  { pattern: /^\s*du(\s|$)/, reason: 'Disk usage (read-only)' },
  { pattern: /^\s*findmnt(\s|$)/, reason: 'Mount points (read-only)' },
  { pattern: /^\s*blkid(\s|$)/, reason: 'Block device attributes (read-only)' },
  // Git read-only
  { pattern: /^\s*git\s+status(\s|$)/, reason: 'Git status (read-only)' },
  { pattern: /^\s*git\s+log(\s|$)/, reason: 'Git log (read-only)' },
  { pattern: /^\s*git\s+diff(\s|$)/, reason: 'Git diff (read-only)' },
  { pattern: /^\s*git\s+show(\s|$)/, reason: 'Git show (read-only)' },
  { pattern: /^\s*git\s+branch(\s|$)/, reason: 'Git branch list (read-only)' },
  { pattern: /^\s*git\s+remote(\s|$)/, reason: 'Git remote list (read-only)' },
  { pattern: /^\s*git\s+tag(\s|$)/, reason: 'Git tag list (read-only)' },
  { pattern: /^\s*git\s+stash\s+list(\s|$)/, reason: 'Git stash list (read-only)' },
  // SSL/TLS info
  { pattern: /^\s*openssl\s+(x509|s_client|verify)(\s|$)/, reason: 'SSL certificate info (read-only)' },
  // Crontab listing
  { pattern: /^\s*crontab\s+-l(\s|$)/, reason: 'Crontab listing (read-only)' },
  // Process info
  { pattern: /^\s*pgrep(\s|$)/, reason: 'Process grep (read-only)' },
  { pattern: /^\s*pidof(\s|$)/, reason: 'Process ID lookup (read-only)' },
  // Firewall query
  { pattern: /^\s*ufw\s+status(\s|$)/, reason: 'Firewall status (read-only)' },
  { pattern: /^\s*iptables\s+-L(\s|$)/, reason: 'Firewall rules list (read-only)' },
  { pattern: /^\s*iptables\s+--list(\s|$)/, reason: 'Firewall rules list (read-only)' },
  // Hardware / sensor info
  { pattern: /^\s*sensors(\s|$)/, reason: 'Hardware sensors (read-only)' },
  { pattern: /^\s*lshw(\s|$)/, reason: 'Hardware info (read-only)' },
  { pattern: /^\s*dmidecode(\s|$)/, reason: 'DMI/SMBIOS info (read-only)' },
  // Terraform read-only
  { pattern: /^\s*terraform\s+(plan|show|state\s+list|output|validate)(\s|$)/, reason: 'Terraform query (read-only)' },
  // Ansible check mode
  { pattern: /^\s*ansible\b.*--check(\s|$)/, reason: 'Ansible dry-run (read-only)' },
  // Helm read-only
  { pattern: /^\s*helm\s+(list|status|get|show|search|history)(\s|$)/, reason: 'Helm query (read-only)' },
  // npm/pnpm/yarn read-only
  { pattern: /^\s*npm\s+(ls|list|outdated|audit|config\s+list)(\s|$)/, reason: 'NPM query (read-only)' },
  { pattern: /^\s*pnpm\s+(ls|list|outdated|audit)(\s|$)/, reason: 'PNPM query (read-only)' },
  { pattern: /^\s*yarn\s+(list|info|why|audit)(\s|$)/, reason: 'Yarn query (read-only)' },
  // Systemd-analyze
  { pattern: /^\s*systemd-analyze(\s|$)/, reason: 'Systemd analysis (read-only)' },
  // Disk health
  { pattern: /^\s*smartctl(\s|$)/, reason: 'S.M.A.R.T. disk health (read-only)' },
  // Network bandwidth
  { pattern: /^\s*iftop(\s|$)/, reason: 'Network bandwidth monitor (read-only)' },
  { pattern: /^\s*nethogs(\s|$)/, reason: 'Network usage per process (read-only)' },
  { pattern: /^\s*bwm-ng(\s|$)/, reason: 'Bandwidth monitor (read-only)' },
  // Compression info
  { pattern: /^\s*zipinfo(\s|$)/, reason: 'ZIP archive info (read-only)' },
  { pattern: /^\s*tar\s+(-[a-zA-Z]*)?t[a-zA-Z]*f\s/, reason: 'Archive listing (read-only)' },
  // AWS CLI read-only
  { pattern: /^\s*aws\s+(s3\s+ls|ec2\s+describe|rds\s+describe|iam\s+list|sts\s+get)/, reason: 'AWS CLI read-only query' },
  { pattern: /^\s*aws\s+ecs\s+(list|describe)/, reason: 'AWS ECS read-only query' },
  { pattern: /^\s*aws\s+lambda\s+(list|get)/, reason: 'AWS Lambda read-only query' },
  // GCP CLI read-only
  { pattern: /^\s*gcloud\s+(compute\s+instances\s+list|info|config\s+list)/, reason: 'GCP CLI read-only query' },
  { pattern: /^\s*gcloud\s+projects\s+list/, reason: 'GCP projects list (read-only)' },
  // Azure CLI read-only
  { pattern: /^\s*az\s+(vm\s+list|account\s+show|group\s+list)/, reason: 'Azure CLI read-only query' },
  // Podman read-only
  { pattern: /^\s*podman\s+(ps|images|logs|inspect|info|version|stats|port)(\s|$)/, reason: 'Podman read-only query' },
  // Redis read-only
  { pattern: /^\s*redis-cli\s+.*\b(INFO|DBSIZE|CONFIG\s+GET|CLIENT\s+LIST|PING)\b/i, reason: 'Redis read-only query' },
  // Vault read-only
  { pattern: /^\s*vault\s+(status|kv\s+get|secrets\s+list|auth\s+list)(\s|$)/, reason: 'Vault read-only query' },
  // Certbot info
  { pattern: /^\s*certbot\s+certificates(\s|$)/, reason: 'Certificate listing (read-only)' },
  // Docker Swarm read-only
  { pattern: /^\s*docker\s+service\s+(ls|logs|inspect|ps)(\s|$)/, reason: 'Docker Swarm service query (read-only)' },
  { pattern: /^\s*docker\s+stack\s+(ls|ps|services)(\s|$)/, reason: 'Docker Swarm stack query (read-only)' },
  { pattern: /^\s*docker\s+node\s+(ls|inspect)(\s|$)/, reason: 'Docker Swarm node query (read-only)' },
  // Virsh read-only
  { pattern: /^\s*virsh\s+(list|dominfo|domstate|nodeinfo|vcpuinfo)(\s|$)/, reason: 'Virsh VM query (read-only)' },
  // Ansible inventory
  { pattern: /^\s*ansible\s+(--list-hosts|.*--list)(\s|$)/, reason: 'Ansible inventory list (read-only)' },
  { pattern: /^\s*ansible-inventory(\s|$)/, reason: 'Ansible inventory (read-only)' },
  // Flatpak/Snap read-only
  { pattern: /^\s*flatpak\s+(list|info|search|remote-ls)(\s|$)/, reason: 'Flatpak query (read-only)' },
  { pattern: /^\s*snap\s+(info|find|connections)(\s|$)/, reason: 'Snap query (read-only)' },
  // Nix read-only
  { pattern: /^\s*nix-env\s+(-q|--query)/, reason: 'Nix package query (read-only)' },
  { pattern: /^\s*nix\s+(search|show|path-info)(\s|$)/, reason: 'Nix query (read-only)' },
  // Cargo read-only
  { pattern: /^\s*cargo\s+(check|test|clippy|doc|bench)(\s|$)/, reason: 'Cargo check/test (read-only)' },
  // Go read-only
  { pattern: /^\s*go\s+(test|vet|list|mod\s+(tidy|graph|verify))(\s|$)/, reason: 'Go check/test (read-only)' },
  // Python read-only
  { pattern: /^\s*pip\s+(list|show|freeze|check)(\s|$)/, reason: 'Pip query (read-only)' },
  { pattern: /^\s*pip3\s+(list|show|freeze|check)(\s|$)/, reason: 'Pip3 query (read-only)' },
  { pattern: /^\s*python3?\s+-m\s+pytest(\s|$)/, reason: 'Python test runner (read-only)' },
  // Ruby read-only
  { pattern: /^\s*gem\s+(list|info|search|environment)(\s|$)/, reason: 'Ruby gem query (read-only)' },
  { pattern: /^\s*bundle\s+(list|show|check|exec)(\s|$)/, reason: 'Ruby bundle query (read-only)' },
  // .NET read-only
  { pattern: /^\s*dotnet\s+(list|test|nuget\s+list)(\s|$)/, reason: '.NET query (read-only)' },
  // PHP read-only
  { pattern: /^\s*composer\s+(show|info|depends|validate|check-platform-reqs)(\s|$)/, reason: 'Composer query (read-only)' },
  { pattern: /^\s*php\s+-v(\s|$)/, reason: 'PHP version (read-only)' },
  // Disk/partition read-only
  { pattern: /^\s*tune2fs\s+-l\s/, reason: 'Filesystem info (read-only)' },
  { pattern: /^\s*xfs_info(\s|$)/, reason: 'XFS filesystem info (read-only)' },
  // Network extended
  { pattern: /^\s*ip\s+(-[46]\s+)?rule(\s+show)?(\s|$)/, reason: 'IP routing rules (read-only)' },
  { pattern: /^\s*ip\s+(-[46]\s+)?tunnel(\s+show)?(\s|$)/, reason: 'IP tunnels (read-only)' },
  { pattern: /^\s*tc\s+(qdisc|class|filter)\s+show(\s|$)/, reason: 'Traffic control info (read-only)' },
  // Kubernetes extended
  { pattern: /^\s*kubectl\s+api-resources(\s|$)/, reason: 'K8s API resources (read-only)' },
  { pattern: /^\s*kubectl\s+config\s+(view|get-contexts|current-context)(\s|$)/, reason: 'K8s config (read-only)' },
  { pattern: /^\s*kubectl\s+version(\s|$)/, reason: 'K8s version (read-only)' },
  // Docker extended
  { pattern: /^\s*docker\s+history(\s|$)/, reason: 'Docker image history (read-only)' },
  { pattern: /^\s*docker\s+image\s+ls(\s|$)/, reason: 'Docker image list (read-only)' },
  { pattern: /^\s*docker\s+container\s+ls(\s|$)/, reason: 'Docker container list (read-only)' },
  { pattern: /^\s*docker\s+system\s+df(\s|$)/, reason: 'Docker disk usage (read-only)' },
  // Systemd extended
  { pattern: /^\s*systemctl\s+list-dependencies(\s|$)/, reason: 'Service dependencies (read-only)' },
  { pattern: /^\s*systemctl\s+list-sockets(\s|$)/, reason: 'Socket list (read-only)' },
  { pattern: /^\s*systemctl\s+cat(\s|$)/, reason: 'Service unit file display (read-only)' },
  // Maven/Gradle read-only
  { pattern: /^\s*mvn\s+(dependency:tree|help|validate|test|verify)(\s|$)/, reason: 'Maven query/test (read-only)' },
  { pattern: /^\s*gradle\s+(dependencies|tasks|properties|test|check)(\s|$)/, reason: 'Gradle query/test (read-only)' },
  // Monitoring tools
  { pattern: /^\s*atop(\s|$)/, reason: 'Advanced system monitor (read-only)' },
  { pattern: /^\s*nmon(\s|$)/, reason: 'System performance monitor (read-only)' },
  { pattern: /^\s*glances(\s|$)/, reason: 'System monitoring (read-only)' },
  { pattern: /^\s*iotop(\s|$)/, reason: 'I/O monitoring (read-only)' },
  { pattern: /^\s*strace\s/, reason: 'System call trace (read-only)' },
  { pattern: /^\s*ltrace\s/, reason: 'Library call trace (read-only)' },
  // Security audit tools (read-only)
  { pattern: /^\s*lynis\s+(audit|show)(\s|$)/, reason: 'Security audit (read-only)' },
  { pattern: /^\s*chkrootkit(\s|$)/, reason: 'Rootkit check (read-only)' },
  { pattern: /^\s*rkhunter\s+--check(\s|$)/, reason: 'Rootkit check (read-only)' },
  // Terraform extended
  { pattern: /^\s*terraform\s+(fmt|graph|providers|version|workspace\s+list)(\s|$)/, reason: 'Terraform info (read-only)' },
];

// YELLOW patterns — installation/download commands
export const YELLOW_PATTERNS: PatternRule[] = [
  // System package installation
  { pattern: /\bapt\s+install\s/, reason: 'Package installation (apt)' },
  { pattern: /\bapt-get\s+install\s/, reason: 'Package installation (apt-get)' },
  { pattern: /\bapt\s+update(\s|$)/, reason: 'Package index update (apt)' },
  { pattern: /\bapt-get\s+update(\s|$)/, reason: 'Package index update (apt-get)' },
  { pattern: /\bapt\s+upgrade(\s|$)/, reason: 'Package upgrade (apt)' },
  { pattern: /\bapt-get\s+upgrade(\s|$)/, reason: 'Package upgrade (apt-get)' },
  { pattern: /\bapt\s+full-upgrade(\s|$)/, reason: 'Full package upgrade (apt)' },
  { pattern: /\bapt-get\s+dist-upgrade(\s|$)/, reason: 'Distribution upgrade (apt-get)' },
  { pattern: /\byum\s+install\s/, reason: 'Package installation (yum)' },
  { pattern: /\byum\s+update(\s|$)/, reason: 'Package update (yum)' },
  { pattern: /\bdnf\s+install\s/, reason: 'Package installation (dnf)' },
  { pattern: /\bdnf\s+update(\s|$)/, reason: 'Package update (dnf)' },
  { pattern: /\bdnf\s+upgrade(\s|$)/, reason: 'Package upgrade (dnf)' },
  { pattern: /\bpacman\s+-S(\s|$)/, reason: 'Package installation (pacman)' },
  { pattern: /\bpacman\s+-Syu(\s|$)/, reason: 'System upgrade (pacman)' },
  { pattern: /\bbrew\s+install\s/, reason: 'Package installation (brew)' },
  { pattern: /\bbrew\s+upgrade(\s|$)/, reason: 'Package upgrade (brew)' },
  { pattern: /\bsnap\s+install\s/, reason: 'Snap package installation' },
  // Node.js package managers
  { pattern: /\bnpm\s+install(\s|$)/, reason: 'NPM package installation' },
  { pattern: /\bnpm\s+i(\s|$)/, reason: 'NPM package installation' },
  { pattern: /\bnpm\s+ci(\s|$)/, reason: 'NPM clean install' },
  { pattern: /\bpnpm\s+(install|add)(\s|$)/, reason: 'PNPM package installation' },
  { pattern: /\byarn\s+(install|add)(\s|$)/, reason: 'Yarn package installation' },
  // Python
  { pattern: /\bpip\s+install\s/, reason: 'Python package installation' },
  { pattern: /\bpip3\s+install\s/, reason: 'Python package installation' },
  { pattern: /\bpipx\s+install\s/, reason: 'Python CLI tool installation' },
  // Ruby
  { pattern: /\bgem\s+install\s/, reason: 'Ruby gem installation' },
  { pattern: /\bbundle\s+install(\s|$)/, reason: 'Ruby bundle installation' },
  // Rust
  { pattern: /\bcargo\s+install\s/, reason: 'Rust package installation' },
  // Go
  { pattern: /\bgo\s+install\s/, reason: 'Go package installation' },
  { pattern: /\bgo\s+get\s/, reason: 'Go module download' },
  // Docker pull
  { pattern: /\bdocker\s+pull\s/, reason: 'Docker image download' },
  { pattern: /\bdocker\s+compose\s+pull(\s|$)/, reason: 'Docker Compose image pull' },
  // Git clone
  { pattern: /\bgit\s+clone\s/, reason: 'Repository cloning' },
  // Downloads
  { pattern: /\bcurl\s+/, reason: 'URL download (curl)' },
  { pattern: /\bwget\s+/, reason: 'URL download (wget)' },
  // Archive extraction
  { pattern: /\btar\s+.*x/, reason: 'Archive extraction' },
  { pattern: /\bunzip\s/, reason: 'Archive extraction' },
  { pattern: /\bgunzip\s/, reason: 'Archive decompression' },
  { pattern: /\bbunzip2\s/, reason: 'Archive decompression' },
  // Build commands
  { pattern: /\bmake(\s|$)/, reason: 'Build command (make)' },
  { pattern: /\bcmake(\s|$)/, reason: 'Build command (cmake)' },
  { pattern: /\bnpm\s+run\s+build(\s|$)/, reason: 'Build command (npm)' },
  { pattern: /\bpnpm\s+build(\s|$)/, reason: 'Build command (pnpm)' },
  { pattern: /\byarn\s+build(\s|$)/, reason: 'Build command (yarn)' },
  { pattern: /\bcargo\s+build(\s|$)/, reason: 'Build command (cargo)' },
  { pattern: /\bgo\s+build(\s|$)/, reason: 'Build command (go)' },
  // Docker build
  { pattern: /\bdocker\s+build\s/, reason: 'Docker image build' },
  { pattern: /\bdocker\s+compose\s+build(\s|$)/, reason: 'Docker Compose build' },
  // Kubernetes apply (non-destructive create/update)
  { pattern: /\bkubectl\s+apply\s/, reason: 'Kubernetes resource apply' },
  { pattern: /\bkubectl\s+create\s/, reason: 'Kubernetes resource create' },
  // Helm install/upgrade
  { pattern: /\bhelm\s+(install|upgrade)\s/, reason: 'Helm chart installation' },
  // Terraform apply
  { pattern: /\bterraform\s+apply\b/, reason: 'Terraform infrastructure apply' },
  // Ansible playbook
  { pattern: /\bansible-playbook\s/, reason: 'Ansible playbook execution' },
  // Container registry push
  { pattern: /\bdocker\s+push\s/, reason: 'Docker image push to registry' },
  // npm publish
  { pattern: /\bnpm\s+publish(\s|$)/, reason: 'NPM package publish' },
  // pip upgrade
  { pattern: /\bpip\s+install\s+--upgrade\s/, reason: 'Python package upgrade' },
  { pattern: /\bpip3\s+install\s+--upgrade\s/, reason: 'Python package upgrade' },
  // PHP Composer
  { pattern: /\bcomposer\s+(install|update|require)(\s|$)/, reason: 'PHP Composer package operation' },
  // Java build tools
  { pattern: /\bmvn\s+(clean|install|deploy|package)(\s|$)/, reason: 'Maven build command' },
  { pattern: /\bgradle\s+(build|clean|publish|assemble)(\s|$)/, reason: 'Gradle build command' },
  // Podman build/pull
  { pattern: /\bpodman\s+(build|pull)\s/, reason: 'Podman image build/pull' },
  // Cloud resource creation
  { pattern: /\baws\s+ec2\s+run-instances\b/, reason: 'AWS EC2 instance creation' },
  { pattern: /\bgcloud\s+compute\s+instances\s+create\b/, reason: 'GCP instance creation' },
  { pattern: /\baz\s+vm\s+create\b/, reason: 'Azure VM creation' },
  // Certbot certificate operations
  { pattern: /\bcertbot\s+(certonly|renew)(\s|$)/, reason: 'SSL certificate management' },
  // .NET build
  { pattern: /\bdotnet\s+(build|publish|restore)(\s|$)/, reason: '.NET build command' },
  // Podman compose
  { pattern: /\bpodman-compose\s+(up|build|pull)(\s|$)/, reason: 'Podman Compose operation' },
  // Flatpak install
  { pattern: /\bflatpak\s+install\s/, reason: 'Flatpak package installation' },
  { pattern: /\bflatpak\s+update(\s|$)/, reason: 'Flatpak package update' },
  // Nix install
  { pattern: /\bnix-env\s+-i\s/, reason: 'Nix package installation' },
  { pattern: /\bnix\s+profile\s+install\s/, reason: 'Nix profile installation' },
  // Snap refresh
  { pattern: /\bsnap\s+refresh(\s|$)/, reason: 'Snap package refresh' },
  // Rustup
  { pattern: /\brustup\s+(update|install|default)(\s|$)/, reason: 'Rust toolchain management' },
  // PHP PECL
  { pattern: /\bpecl\s+install\s/, reason: 'PHP PECL extension installation' },
  // Lua
  { pattern: /\bluarocks\s+install\s/, reason: 'Lua package installation' },
];

// RED patterns — modification commands
export const RED_PATTERNS: PatternRule[] = [
  // Service management
  { pattern: /\bsystemctl\s+(restart|stop|start|reload|enable|disable)\s/, reason: 'Service management command' },
  { pattern: /\bservice\s+\S+\s+(restart|stop|start|reload)(\s|$)/, reason: 'Service management command' },
  // Nginx reload/restart
  { pattern: /\bnginx\s+-s\s+(reload|stop|quit|reopen)/, reason: 'Nginx signal command' },
  // Apache management
  { pattern: /\bapachectl\s+(restart|stop|start|graceful)(\s|$)/, reason: 'Apache management command' },
  // Docker container management
  { pattern: /\bdocker\s+(stop|restart|start|kill|pause|unpause)\s/, reason: 'Docker container management' },
  { pattern: /\bdocker\s+compose\s+(up|down|restart|stop|start)(\s|$)/, reason: 'Docker Compose management' },
  { pattern: /\bdocker\s+exec\s/, reason: 'Docker container exec' },
  { pattern: /\bdocker\s+run\s/, reason: 'Docker container run' },
  { pattern: /\bdocker\s+compose\s+exec\s/, reason: 'Docker Compose exec' },
  // Permission changes
  { pattern: /\bchmod\s/, reason: 'File permission change' },
  { pattern: /\bchown\s/, reason: 'File ownership change' },
  { pattern: /\bchgrp\s/, reason: 'File group change' },
  { pattern: /\bsetfacl\s/, reason: 'File ACL modification' },
  // File editing/creation
  { pattern: /\bsed\s+-i/, reason: 'In-place file editing' },
  { pattern: /\btee\s/, reason: 'File writing via tee' },
  { pattern: /\bpatch\s/, reason: 'File patching' },
  // Configuration editing
  { pattern: /\bcp\s/, reason: 'File copy operation' },
  { pattern: /\bmv\s/, reason: 'File move/rename operation' },
  { pattern: /\bmkdir\s/, reason: 'Directory creation' },
  { pattern: /\btouch\s/, reason: 'File creation/timestamp update' },
  { pattern: /\bln\s/, reason: 'Link creation' },
  // Git operations that modify state
  { pattern: /\bgit\s+(push|commit|merge|rebase|reset|checkout)(\s|$)/, reason: 'Git state modification' },
  { pattern: /\bgit\s+pull(\s|$)/, reason: 'Git pull (merge)' },
  { pattern: /\bgit\s+stash(\s|$)/, reason: 'Git stash' },
  { pattern: /\bgit\s+cherry-pick(\s|$)/, reason: 'Git cherry-pick' },
  // Cron management
  { pattern: /\bcrontab\s/, reason: 'Crontab modification' },
  // Firewall changes
  { pattern: /\bufw\s+(allow|deny|delete|enable|disable)/, reason: 'Firewall rule modification' },
  { pattern: /\biptables\s/, reason: 'Firewall rule modification' },
  // Network configuration
  { pattern: /\bip\s+(addr|link|route)\s+(add|del|change)/, reason: 'Network configuration change' },
  // User/group modification (non-destructive)
  { pattern: /\buseradd\s/, reason: 'User creation' },
  { pattern: /\busermod\s/, reason: 'User modification' },
  { pattern: /\bgroupadd\s/, reason: 'Group creation' },
  { pattern: /\bpasswd\s/, reason: 'Password change' },
  // Process management
  { pattern: /\bkill\s/, reason: 'Process termination' },
  { pattern: /\bkillall\s/, reason: 'Process termination (by name)' },
  { pattern: /\bpkill\s/, reason: 'Process termination (by pattern)' },
  // Mount/unmount
  { pattern: /\bmount\s+-/, reason: 'Filesystem mount' },
  { pattern: /\bumount\s/, reason: 'Filesystem unmount' },
  // Kubernetes modification
  { pattern: /\bkubectl\s+(scale|edit|patch|rollout|set)(\s|$)/, reason: 'Kubernetes resource modification' },
  { pattern: /\bkubectl\s+exec\s/, reason: 'Kubernetes pod exec' },
  // npm/pnpm scripts (arbitrary execution)
  { pattern: /\bnpm\s+run\s+(?!build)(\S+)(\s|$)/, reason: 'NPM script execution' },
  { pattern: /\bpnpm\s+run\s/, reason: 'PNPM script execution' },
  // Write redirection
  { pattern: /\b\S+\s*>>?\s+\//, reason: 'File write redirection' },
  // Helm modification
  { pattern: /\bhelm\s+(uninstall|rollback|delete)\s/, reason: 'Helm chart modification' },
  // Terraform state manipulation
  { pattern: /\bterraform\s+state\s+(mv|rm|push)\s/, reason: 'Terraform state modification' },
  // SSH remote execution
  { pattern: /\bssh\s+.*\S+@\S+\s/, reason: 'Remote SSH command execution' },
  // rsync (file sync / modification)
  { pattern: /\brsync\s/, reason: 'File synchronization (rsync)' },
  // Environment variable modification
  { pattern: /\bexport\s/, reason: 'Environment variable modification' },
  // Systemd unit file editing
  { pattern: /\bsystemctl\s+(daemon-reload|daemon-reexec)(\s|$)/, reason: 'Systemd daemon reload' },
  // Swap management
  { pattern: /\bswapon\s/, reason: 'Swap partition activation' },
  { pattern: /\bmkswap\s/, reason: 'Swap partition creation' },
  // Podman container management
  { pattern: /\bpodman\s+(stop|restart|start|kill|pause|exec|run)\s/, reason: 'Podman container management' },
  { pattern: /\bpodman-compose\s+(down|restart|stop|start)(\s|$)/, reason: 'Podman Compose management' },
  // Cloud resource modification
  { pattern: /\baws\s+ec2\s+(stop-instances|start-instances|reboot-instances)\b/, reason: 'AWS EC2 instance state change' },
  { pattern: /\baws\s+s3\s+(cp|mv|sync)\s/, reason: 'AWS S3 data modification' },
  { pattern: /\bgcloud\s+compute\s+instances\s+(stop|start|reset)\b/, reason: 'GCP instance state change' },
  { pattern: /\baz\s+vm\s+(stop|start|restart|deallocate)\b/, reason: 'Azure VM state change' },
  // Virsh VM management (non-destructive)
  { pattern: /\bvirsh\s+(start|suspend|resume)\s/, reason: 'VM state management (virsh)' },
  // Composer remove
  { pattern: /\bcomposer\s+remove\s/, reason: 'PHP Composer package removal' },
  // Docker Swarm service modification
  { pattern: /\bdocker\s+service\s+(update|scale|rollback)\s/, reason: 'Docker Swarm service modification' },
  // Vault write operations
  { pattern: /\bvault\s+kv\s+put\s/, reason: 'Vault secret write' },
  { pattern: /\bvault\s+auth\s+(enable|disable)\s/, reason: 'Vault auth method modification' },
  // Logrotate forced execution
  { pattern: /\blogrotate\s+-f\s/, reason: 'Forced log rotation' },
  // Auditctl rules modification
  { pattern: /\bauditctl\s/, reason: 'Audit rules modification' },
  // Database modification (non-destructive)
  { pattern: /\bINSERT\s+INTO\s+/i, reason: 'Database insert operation' },
  { pattern: /\bUPDATE\s+.*\bSET\b/i, reason: 'Database update operation' },
  { pattern: /\bGRANT\s+/i, reason: 'Database privilege grant' },
  { pattern: /\bALTER\s+TABLE\s+.*\bADD\b/i, reason: 'Database schema modification' },
  { pattern: /\bCREATE\s+(TABLE|INDEX|VIEW|DATABASE)\b/i, reason: 'Database object creation' },
  // System configuration modification
  { pattern: /\bsysctl\s+-w\s/, reason: 'Kernel parameter modification' },
  { pattern: /\btimedatectl\s+set/, reason: 'System time/timezone modification' },
  { pattern: /\bhostnamectl\s+set/, reason: 'System hostname modification' },
  { pattern: /\blocalectl\s+set/, reason: 'System locale modification' },
  // Snap management
  { pattern: /\bsnap\s+(set|connect|disconnect|alias)(\s|$)/, reason: 'Snap configuration modification' },
  // Flatpak management
  { pattern: /\bflatpak\s+override\s/, reason: 'Flatpak permission override' },
  // Git advanced operations
  { pattern: /\bgit\s+clean\s/, reason: 'Git working tree cleanup' },
  { pattern: /\bgit\s+revert\s/, reason: 'Git commit revert' },
  { pattern: /\bgit\s+am\s/, reason: 'Git apply mailbox patches' },
  { pattern: /\bgit\s+bisect\s/, reason: 'Git binary search' },
  // Helm extended
  { pattern: /\bhelm\s+repo\s+(add|remove|update)(\s|$)/, reason: 'Helm repository modification' },
  // Terraform extended
  { pattern: /\bterraform\s+(init|import|taint|untaint)(\s|$)/, reason: 'Terraform state/init modification' },
  // Crontab replacement
  { pattern: /\bat\s+/, reason: 'Scheduled command (at)' },
  // Podman extended
  { pattern: /\bpodman\s+push\s/, reason: 'Podman image push to registry' },
  { pattern: /\bpodman\s+commit\s/, reason: 'Podman container commit' },
  // Docker commit/tag
  { pattern: /\bdocker\s+commit\s/, reason: 'Docker container commit' },
  { pattern: /\bdocker\s+tag\s/, reason: 'Docker image tagging' },
  // Kubernetes extended
  { pattern: /\bkubectl\s+cordon\s/, reason: 'Kubernetes node cordon' },
  { pattern: /\bkubectl\s+uncordon\s/, reason: 'Kubernetes node uncordon' },
  { pattern: /\bkubectl\s+drain\s/, reason: 'Kubernetes node drain' },
  { pattern: /\bkubectl\s+taint\s/, reason: 'Kubernetes node taint' },
  { pattern: /\bkubectl\s+label\s/, reason: 'Kubernetes resource labeling' },
  { pattern: /\bkubectl\s+annotate\s/, reason: 'Kubernetes resource annotation' },
  // IP route modification
  { pattern: /\bip\s+route\s+(add|del|change|replace)\s/, reason: 'IP routing modification' },
];
