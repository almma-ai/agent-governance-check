# Freezing the AlmmaGPT study data

Makes a sealed, encrypted copy of exactly the AlmmaGPT data the governance
check reads, so the paper's figures can be checked later against the data they
came from.

## What is copied

| Collection | Fields kept |
| --- | --- |
| agents | all (instructions, tools, versions, sharing, support contact) |
| conversations | `_id`, `agent_id`, `createdAt`, `updatedAt` only: no titles, no messages |
| users | `_id` only |
| aclentries, projects, sharedagents, auditlogs | all |
| agentapikeys | `_id`, `userId`, `agent_id`, `createdAt`, `lastUsedAt`: no key material |
| memoryentries | `_id`, `userId`, `createdAt`: no memory text |
| actions | `_id`, `agent_id`, domain and auth type: no credentials |
| messages | not copied; only the count is recorded |

Agent instructions and support contacts can contain personal information, which
is why the archive is encrypted and never published. Only its SHA-256
fingerprint is published.

## Steps

1. On a machine that can reach the AlmmaGPT database, install MongoDB Database
   Tools (`mongoexport`, `mongoimport`), `mongosh`, Docker, `gpg` and Node.js.
2. Create a read-only database user (role `read` on the AlmmaGPT database).
3. Clone this repository and run, from its root:

   ```
   MONGO_URI='mongodb://USER:PASS@HOST:27017/?authSource=admin' \
   DB_NAME=LibreChat \
   ./scripts/freeze/freeze_snapshot.sh
   ```

   `gpg` asks for a passphrase. Store it in the password manager; without it
   the archive cannot be opened.
4. Read the comparison at the end. "MATCH", or differences only in
   conversation counts from chats during the export, means the copy is good.
5. Keep the two files it prints: the `.tar.gz.gpg` archive and its `.sha256`.
   Store the archive in two places that are not the production server. Then
   delete the clear-text folder.
6. Send the `.sha256` line and `runs/` outputs' fingerprints to the
   investigator, who records them in the paper.

Retention: five years after final publication, as in the study protocol.
