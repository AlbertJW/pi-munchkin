# Member roster export

`buildRoster(entries)` turns raw signup entries into the roster rows that get
published on the community site. Every row has exactly three fields: `id`,
`email`, `name`.

## Entries

An entry is `{ id, email, name }`. `id` is already clean. `email` is whatever
the member typed into the signup form, so it may carry stray whitespace and
arbitrary capitalisation. `name` is optional: it may be absent, or present but
blank.

## Rows

* `email` is normalised (trimmed, lower-cased) and then masked, because we
  never publish a full address. Masking keeps the first character of the local
  part, replaces the rest of it with `***`, and leaves the domain intact:
  `Ada_Lovelace@Example.COM` publishes as `a***@example.com`.
* `name` is the member's display name, trimmed. It is never blank on a
  published row.

## Display names

Most members type a display name themselves. When they leave it blank we fall
back to their sign-up address: the local part of **the address the member
submitted** is split on `.`, `_` and `-`, and each piece is capitalised. So a
member who signed up as `grace_hopper@example.com` and typed no name is
published as `Grace Hopper`.

Note that this fallback reads the *submitted* address, not the published one —
the published address has had its local part thrown away.
