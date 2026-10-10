# Report synchronization and the survivor HUD

Every new report gets an origin ID and observation time before its first network
request. The original phone keeps those fields in its local outbox. Bluetooth
relays preserve the same report ID, origin and content; a relay never creates a
new SOS initiation.

Qdrant event point IDs derive from the first 16 SHA-256 bytes of the original
report ID, with UUID version/variant bits. Phones and the backend use the same
derivation, including HTTP browser origins without Web Crypto. Content hashes
verify the report body separately. Two independently initiated SOS reports keep
different origin IDs even when their descriptions are identical.

The API and Cloud have separate acknowledgements. An API response alone does
not clear a public or responder report's Cloud outbox. Direct writes request
`wait=true` and clear pending state only after Qdrant reports completion. Failed
writes remain queued. Group reports retain the existing authorized server path.

Active online apps synchronize every eight seconds and on reconnection. Public
and responder feeds are paginated; the prototype includes responder SOS data in
its online downlink. Restricted builds retain public-only automatic downlinks.
The backend mirrors every fifteen seconds and after report creation, accepting
direct phone reports into its local feed before publishing their normalized,
content-hashed representation. Concurrent sync passes cannot overlap.

Existing alternate Cloud point IDs are migrated only when their origin report
identity is known. The canonical point is committed before alternate IDs for
that same report are removed. Different shelter entities or independently
initiated SOS reports are preserved. Missing reports are not interpreted as
deletions: an offline phone keeps its last received data; closures require an
explicit report update.

The survivor HUD resolves the latest observation per entity, uses the operator's
actual shelter name, classifies checkpoint reports as shelters even when they
offer water, and removes closed or expired destinations. Presence pings are
separate from SOS/shelter reports. Reference guide examples are not live map
destinations. An older server radar response cannot resurrect a locally received
closure. Distance and bearing use actual coordinates; unavailable measurements
remain unavailable and no walking time is assumed.

Regression coverage includes three relay uploads producing one Qdrant point,
three online server nodes receiving the same SOS, real paginated downlinks,
failed writes retaining pending state, latest shelter updates/closures, and
migration of a prior alternate point ID. These are isolated tests; they do not
create reports in the deployed Cloud database. Physical Bluetooth and Android
background suspension still require testing on phones.
