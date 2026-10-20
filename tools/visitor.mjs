// visitor.mjs: since the cookie banner (2026-10-04), the browser checks that are not about it run as a visitor who has
// already answered it, with a no, so the banner never covers what they click or measure and nothing loads from Google.
// shoot.mjs and consent-test.mjs see the first visit, banner and all.
export const CONSENT_KEY = 'karumnieki-consent';

export async function answered(ctx, analytics = false) {
  await ctx.addInitScript(([key, yes]) => {
    try { localStorage.setItem(key, JSON.stringify({ v: 1, analytics: yes, at: new Date().toISOString() })); } catch (e) {}
  }, [CONSENT_KEY, analytics]);
  return ctx;
}
