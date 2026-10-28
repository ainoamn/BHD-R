import type { EmailTone } from '@/lib/email-template';

export type EmailWishPoolsView = {
  wishes: Record<EmailTone, string[]>;
  sparks: string[];
  greetingsNamed: string[];
  greetingsAnon: string[];
  usingDefaults: boolean;
};
