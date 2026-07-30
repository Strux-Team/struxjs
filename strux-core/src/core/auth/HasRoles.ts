export interface RolePermissionModel {
    roles?: string[];
    permissions?: string[];
    [key: string]: any;
}

export class HasRoles {
    /**
     * Check if user model instance has a specific role
     */
    public static hasRole(user: any, role: string): boolean {
        if (!user) return false;
        const roles: string[] = Array.isArray(user.roles) ? user.roles : [];
        return roles.includes(role);
    }

    /**
     * Check if user has any of the given roles
     */
    public static hasAnyRole(user: any, roles: string[]): boolean {
        if (!user) return false;
        const userRoles: string[] = Array.isArray(user.roles) ? user.roles : [];
        return roles.some(r => userRoles.includes(r));
    }

    /**
     * Check if user has all of the given roles
     */
    public static hasAllRoles(user: any, roles: string[]): boolean {
        if (!user) return false;
        const userRoles: string[] = Array.isArray(user.roles) ? user.roles : [];
        return roles.every(r => userRoles.includes(r));
    }

    /**
     * Check if user has a specific permission (either directly or via role)
     */
    public static hasPermissionTo(user: any, permission: string): boolean {
        if (!user) return false;

        // Direct permission check
        const directPermissions: string[] = Array.isArray(user.permissions) ? user.permissions : [];
        if (directPermissions.includes(permission)) return true;

        // Superadmin bypass if configured
        if (this.hasRole(user, "super-admin") || this.hasRole(user, "admin")) {
            return true;
        }

        return false;
    }

    /**
     * Assign one or more roles to user model instance
     */
    public static assignRole(user: any, ...roles: string[]): any {
        if (!user.roles) user.roles = [];
        for (const role of roles) {
            if (!user.roles.includes(role)) {
                user.roles.push(role);
            }
        }
        return user;
    }

    /**
     * Remove one or more roles from user model instance
     */
    public static removeRole(user: any, ...roles: string[]): any {
        if (Array.isArray(user.roles)) {
            user.roles = user.roles.filter((r: string) => !roles.includes(r));
        }
        return user;
    }

    /**
     * Grant direct permission to user
     */
    public static givePermissionTo(user: any, ...permissions: string[]): any {
        if (!user.permissions) user.permissions = [];
        for (const perm of permissions) {
            if (!user.permissions.includes(perm)) {
                user.permissions.push(perm);
            }
        }
        return user;
    }

    /**
     * Revoke direct permission from user
     */
    public static revokePermissionTo(user: any, ...permissions: string[]): any {
        if (Array.isArray(user.permissions)) {
            user.permissions = user.permissions.filter((p: string) => !permissions.includes(p));
        }
        return user;
    }
}
