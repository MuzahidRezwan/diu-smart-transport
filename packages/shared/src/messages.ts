/**
 * Reasons the API puts in "?error=" when it sends a rider back from university
 * sign-in. Web and mobile show the same text.
 */
export const SSO_FAILURE_MESSAGES = {
  sign_in_cancelled: 'Sign-in was cancelled.',
  sign_in_failed: 'The university sign-in did not complete. Try again.',
  missing_code: 'The university sign-in did not complete. Try again.',
  university_unavailable: 'The university sign-in system is not reachable right now. Try again in a few minutes.',
  not_in_directory: 'Your ID was not found in the university directory. Contact the IT office.',
  use_authority_login: 'This is a transport office account. Use the "Transport office" sign-in.',
} as const;

export type SsoFailureReason = keyof typeof SSO_FAILURE_MESSAGES;

export function ssoFailureMessage(reason: string): string {
  return (SSO_FAILURE_MESSAGES as Record<string, string>)[reason] ?? 'Sign-in did not complete. Try again.';
}
