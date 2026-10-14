/** What shows beside a name anywhere: the verified tick and the chosen picture. */
export type IdentityMark = { verified: boolean; avatarUrl: string | null };

export const NO_MARK: IdentityMark = { verified: false, avatarUrl: null };
