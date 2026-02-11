// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useEffect, useState, useCallback } from 'react';
import {
  Plus,
  Loader2,
  AlertCircle,
  Users,
  Mail,
  Trash2,
  XCircle,
  Shield,
  Crown,
  User,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useTeamStore } from '@/stores/team';
import { ROLE_LABELS } from '@/types/team';
import type { TeamMember, Invitation } from '@/types/team';

// ============================================================================
// Team Page
// ============================================================================

export function Team() {
  const {
    members,
    invitations,
    isLoading,
    error,
    fetchMembers,
    fetchInvitations,
    createInvitation,
    cancelInvitation,
    updateMemberRole,
    removeMember,
    clearError,
  } = useTeamStore();

  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TeamMember | null>(null);
  const [roleTarget, setRoleTarget] = useState<TeamMember | null>(null);

  useEffect(() => {
    fetchMembers();
    fetchInvitations();
  }, [fetchMembers, fetchInvitations]);

  const handleRemoveConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await removeMember(deleteTarget.id);
    } catch { /* handled by store */ }
    setDeleteTarget(null);
  }, [deleteTarget, removeMember]);

  const handleRoleChange = useCallback(async (member: TeamMember, newRole: 'admin' | 'member') => {
    try {
      await updateMemberRole(member.id, newRole);
    } catch { /* handled by store */ }
    setRoleTarget(null);
  }, [updateMemberRole]);

  const handleCancelInvitation = useCallback(async (id: string) => {
    try {
      await cancelInvitation(id);
    } catch { /* handled by store */ }
  }, [cancelInvitation]);

  const pendingInvitations = invitations.filter((inv) => inv.status === 'pending');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">Team</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage team members and send invitations.
          </p>
        </div>
        <Button onClick={() => setShowInviteDialog(true)} className="w-full sm:w-auto">
          <Plus className="mr-2 h-4 w-4" />
          Invite Member
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={clearError}>
            Dismiss
          </Button>
        </div>
      )}

      {/* Loading */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Members Section */}
          <div>
            <h2 className="mb-3 text-lg font-semibold text-foreground">
              Members ({members.length})
            </h2>
            {members.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Users className="h-12 w-12 text-muted-foreground/50" />
                <p className="mt-2 text-sm text-muted-foreground">No members yet.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {members.map((member) => (
                  <MemberCard
                    key={member.id}
                    member={member}
                    onChangeRole={() => setRoleTarget(member)}
                    onRemove={() => setDeleteTarget(member)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Pending Invitations Section */}
          {pendingInvitations.length > 0 && (
            <div>
              <h2 className="mb-3 text-lg font-semibold text-foreground">
                Pending Invitations ({pendingInvitations.length})
              </h2>
              <div className="space-y-2">
                {pendingInvitations.map((inv) => (
                  <InvitationCard
                    key={inv.id}
                    invitation={inv}
                    onCancel={() => handleCancelInvitation(inv.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Invite Dialog */}
      <InviteDialog
        open={showInviteDialog}
        onOpenChange={setShowInviteDialog}
        onSubmit={async (email, role) => {
          await createInvitation(email, role);
          setShowInviteDialog(false);
        }}
      />

      {/* Remove Confirmation */}
      <RemoveDialog
        open={!!deleteTarget}
        name={deleteTarget?.name ?? deleteTarget?.email ?? ''}
        onConfirm={handleRemoveConfirm}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Role Change Dialog */}
      {roleTarget && (
        <RoleDialog
          open={true}
          member={roleTarget}
          onConfirm={handleRoleChange}
          onCancel={() => setRoleTarget(null)}
        />
      )}
    </div>
  );
}

// ============================================================================
// Member Card
// ============================================================================

function RoleIcon({ role }: { role: string }) {
  if (role === 'owner') return <Crown className="h-3.5 w-3.5" />;
  if (role === 'admin') return <Shield className="h-3.5 w-3.5" />;
  return <User className="h-3.5 w-3.5" />;
}

function MemberCard({
  member,
  onChangeRole,
  onRemove,
}: {
  member: TeamMember;
  onChangeRole: () => void;
  onRemove: () => void;
}) {
  const isOwner = member.role === 'owner';

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-foreground">
              {member.name ?? member.email}
            </h3>
            <Badge
              variant={isOwner ? 'default' : member.role === 'admin' ? 'secondary' : 'outline'}
              className="text-xs"
            >
              <RoleIcon role={member.role} />
              <span className="ml-1">{ROLE_LABELS[member.role]}</span>
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">{member.email}</p>
        </div>

        {!isOwner && (
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="sm" onClick={onChangeRole} title="Change role">
              <Shield className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onRemove}
              title="Remove member"
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Invitation Card
// ============================================================================

function InvitationCard({
  invitation,
  onCancel,
}: {
  invitation: Invitation;
  onCancel: () => void;
}) {
  const expiresAt = new Date(invitation.expiresAt);
  const daysLeft = Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-foreground">{invitation.email}</span>
            <Badge variant="outline" className="text-xs">
              {ROLE_LABELS[invitation.role]}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Expires in {daysLeft} day{daysLeft !== 1 ? 's' : ''}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="text-destructive hover:text-destructive"
          title="Cancel invitation"
        >
          <XCircle className="mr-1.5 h-4 w-4" />
          Cancel
        </Button>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Invite Dialog
// ============================================================================

function InviteDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (email: string, role: 'admin' | 'member') => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!email.trim()) return;
    setIsSubmitting(true);
    try {
      await onSubmit(email.trim(), role);
      setEmail('');
      setRole('member');
    } catch { /* handled by store */ } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite Team Member</DialogTitle>
          <DialogDescription>
            Send an invitation link to add a new member to your team.
            The invitation is valid for 7 days.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="colleague@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Role</Label>
            <div className="flex gap-2">
              <Button
                variant={role === 'member' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setRole('member')}
                type="button"
              >
                <User className="mr-1.5 h-3.5 w-3.5" />
                Member
              </Button>
              <Button
                variant={role === 'admin' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setRole('admin')}
                type="button"
              >
                <Shield className="mr-1.5 h-3.5 w-3.5" />
                Admin
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || !email.trim()}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send Invitation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Remove Confirmation Dialog
// ============================================================================

function RemoveDialog({
  open,
  name,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remove Member</DialogTitle>
          <DialogDescription>
            Are you sure you want to remove &quot;{name}&quot; from the team?
            They will lose access to all team resources.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm}>Remove</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Role Change Dialog
// ============================================================================

function RoleDialog({
  open,
  member,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  member: TeamMember;
  onConfirm: (member: TeamMember, role: 'admin' | 'member') => void;
  onCancel: () => void;
}) {
  const newRole = member.role === 'admin' ? 'member' : 'admin';

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change Role</DialogTitle>
          <DialogDescription>
            Change {member.name ?? member.email}&apos;s role from{' '}
            <strong>{ROLE_LABELS[member.role]}</strong> to{' '}
            <strong>{ROLE_LABELS[newRole]}</strong>?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={() => onConfirm(member, newRole)}>Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
