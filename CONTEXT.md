# DB Manage

A web application to connect to, inspect, and manage MySQL database instances.

## Language

**User Database**:
A custom database created for application data on a MySQL server, excluding internal server schemas.
_Avoid_: Custom DB, App DB, Schema

**System Database**:
Built-in MySQL administrative and metadata schemas (`information_schema`, `mysql`, `performance_schema`, `sys`) that are excluded from user database listing.
_Avoid_: Admin DB, Internal DB, Root DB

**Saved Connection**:
A stored MySQL connection string associated with an authenticated user account, representing a previously verified server target. Stored encrypted at rest and presented with masked credentials in the dashboard.
_Avoid_: Connection History, Saved DB, Server Profile

**Database Backup**:
An exported snapshot of a User Database's schema and records, serialized as a compressed SQL dump, stored in S3-compatible object storage, and registered with metadata in the application database.
_Avoid_: Dump, Snapshot, DB Export, Archive

