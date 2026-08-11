// Builds the public member roster that gets exported to the community site.
//
// Raw entries come straight off the signup form, so they are messy: addresses
// arrive with stray whitespace and mixed case, and the display name field is
// optional.

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

// Members are never listed with a full address on the public site.
function maskEmail(email) {
  const at = email.indexOf('@');
  return email[0] + '***' + email.slice(at);
}

export function buildRoster(entries) {
  return entries
    .map((entry) => ({
      id: entry.id,
      email: normalizeEmail(entry.email),
      name: (entry.name ?? '').trim(),
    }))
    .map((member) => ({ ...member, email: maskEmail(member.email) }));
}
