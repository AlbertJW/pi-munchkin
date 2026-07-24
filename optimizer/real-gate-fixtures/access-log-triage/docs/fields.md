# Access log field reference

Each line of data/access.log is one JSON object:
  { "ts": string, "method": string, "path": string, "status": number, "bytes": number }

A line is malformed if it fails one of these checks (record the reason code):
- "invalid-json" -- the line is not valid JSON at all (truncated, corrupt, wrong quoting, etc.)
- "bad-status"   -- status is missing, not an integer, or outside 100-599
- "bad-bytes"    -- bytes is missing, not an integer, or negative

## Example lines (the first 15 lines of data/access.log)

{"ts":"2026-07-20T10:00:01Z","method":"GET","path":"/api/users","status":200,"bytes":512}
{"ts":"2026-07-20T10:00:02Z","method":"POST","path":"/api/orders","status":201,"bytes":128}
{"ts":"2026-07-20T10:00:03Z","method":"GET","path":"/api/users/1","status":999,"bytes":64}
{"ts":"2026-07-20T10:00:04Z","method":"GET","path":"/api/orders","status":200,"bytes":-5}
{"ts":"2026-07-20T10:00:05Z","method":"DELETE","path":"/api/orders/9","status":204,"bytes":0}
{"ts":"2026-07-20T10:00:06Z","method":"GET","path":"/api/health","status":200,"bytes":10
{"ts":"2026-07-20T10:00:07Z","method":"GET","path":"/api/users","status":200,"bytes":256}
{"ts":"2026-07-20T10:00:08Z","method":"PUT","path":"/api/users/2","status":200,"bytes":64}
{"ts":"2026-07-20T10:00:09Z","method":"GET","path":"/api/orders/3","status":"200","bytes":32}
{"ts":"2026-07-20T10:00:10Z","method":"GET","path":"/api/health","status":200,"bytes":8}
{'ts':'2026-07-20T10:00:11Z','method':'GET','path':'/api/users','status':200,'bytes':16}
{"ts":"2026-07-20T10:00:12Z","method":"POST","path":"/api/orders","status":201,"bytes":96}
{"ts":"2026-07-20T10:00:13Z","method":"GET","path":"/api/users/4","status":200,"bytes":12.5}
{"ts":"2026-07-20T10:00:14Z","method":"GET","path":"/api/orders/5","status":200,"bytes":48}
{"ts":"2026-07-20T10:00:15Z","method":"DELETE","path":"/api/users/6","status":204,"bytes":0}

Line 6 above is a genuine example of "invalid-json" -- truncated mid-object, no closing brace.
Line 9's status is the string "200", not the number 200 -- also malformed (bad-status), since
the type must be a number. Line 11 uses single quotes, which is not valid JSON. Line 13's bytes
is 12.5, a non-integer -- also malformed (bad-bytes).

The rest of data/access.log continues in the same style: a realistic mix of well-formed lines
and lines malformed under each of the three reason codes above, spread throughout the file.
