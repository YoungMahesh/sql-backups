# DB Manage

A web application to connect to, inspect, and manage MySQL database instances.

## Language

**User Database**:
A custom database created for application data on a MySQL server, excluding internal server schemas.
_Avoid_: Custom DB, App DB, Schema

**System Database**:
Built-in MySQL administrative and metadata schemas (`information_schema`, `mysql`, `performance_schema`, `sys`) that are excluded from user database listing.
_Avoid_: Admin DB, Internal DB, Root DB
