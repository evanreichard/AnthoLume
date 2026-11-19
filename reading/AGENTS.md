# Reading ownership

- This package owns shared progress, activity, device ownership and event decisions. No Gin, HTTP adapter or generated web DTO dependencies.
- Check the account before receipt access; look up normalized immutable receipts before CAS and new-effect resource checks. UTC instants and signed zero normalize; opaque positions and identity strings do not.
- Head, legacy effect and receipt commit together. A conflict is retained, not rebased; exact retry returns the original decision after later writes/reopen. Receipts have no TTL.
- Web events never create placeholder documents/devices. KO placeholder/device registration is transactional and cannot transfer another account's device. SyncNinja accepts historical activity for tombstoned books so the device cursor keeps advancing without restoring catalog access.
- Heads order accepted writes by revision, not fraction/client clock/legacy timestamp. Historical seeding runs once in the additive migration, with device-ID ascending for timestamp ties.
