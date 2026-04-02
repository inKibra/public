# InKibra Data Tool

A command-line tool for managing Couchbase data operations including counting, deleting, downloading, uploading, and cloning collections.

## Installation

```bash
bun install
```

## Commands

### Clone Collections

Clone collections from a source database to a destination database. Supports cloning entire collections or specific types within collections.

```bash
bun run packages/inkibra/data-tool/cli.ts clone
```

**Collection Specification Format:**
- `collection` - Clone all documents in the collection
- `collection:type` - Clone only documents with the specified type in the collection

**Required Environment Variables:**

```bash
# Collections to clone (comma-separated)
# Examples:
# - Clone entire collections: users,orders,products
# - Clone specific types: users:admin,orders:completed,products:electronics
# - Mix both: users,orders:completed,products
CLONE_COLLECTIONS=collection1,collection2:type2,collection3

# Source Database Configuration
SOURCE_DB_COUCHBASE_HOST=couchbase://source-host:8091
SOURCE_DB_COUCHBASE_USER=source-username
SOURCE_DB_COUCHBASE_PASSWORD=source-password
SOURCE_DB_COUCHBASE_BUCKET=source-bucket
SOURCE_DB_COUCHBASE_SCOPE=source-scope

# Destination Database Configuration
DEST_DB_COUCHBASE_HOST=couchbase://dest-host:8091
DEST_DB_COUCHBASE_USER=dest-username
DEST_DB_COUCHBASE_PASSWORD=dest-password
DEST_DB_COUCHBASE_BUCKET=dest-bucket
DEST_DB_COUCHBASE_SCOPE=dest-scope
```

**Examples:**

```bash
# Clone all documents from users and products collections
CLONE_COLLECTIONS=users,products

# Clone only admin users and electronic products
CLONE_COLLECTIONS=users:admin,products:electronics

# Clone all orders and only premium customers
CLONE_COLLECTIONS=orders,customers:premium

# Clone multiple types from same collection (separate entries)
CLONE_COLLECTIONS=users:admin,users:moderator,products:electronics,products:books
```

### Count Documents

Count all documents in a collection or documents of a specific type.

```bash
# Count all documents in a collection
bun run packages/inkibra/data-tool/cli.ts count <collection>

# Count documents of a specific type
bun run packages/inkibra/data-tool/cli.ts count <collection> --type <type>
```

### Delete Documents

Delete all documents in a collection or documents of a specific type.

```bash
# Delete all documents in a collection
bun run packages/inkibra/data-tool/cli.ts delete <collection>

# Delete documents of a specific type
bun run packages/inkibra/data-tool/cli.ts delete <collection> --type <type>
```

### Download Collection

Download all documents from a collection and save to a JSON file.

```bash
bun run packages/inkibra/data-tool/cli.ts download <collection> <path>
```

### Upload Collection

Upload documents to a collection from a JSON file.

```bash
# Upload from a saved collection file
bun run packages/inkibra/data-tool/cli.ts upload <path> <collection>

# Upload from a list of objects
bun run packages/inkibra/data-tool/cli.ts upload <path> <collection> --list
```

## Environment Variables for Standard Commands

For count, delete, download, and upload commands:

```bash
DATA_TOOL_CLI_COUCHBASE_HOST=couchbase://localhost:8091
DATA_TOOL_CLI_COUCHBASE_USER=username
DATA_TOOL_CLI_COUCHBASE_PASSWORD=password
DATA_TOOL_CLI_COUCHBASE_BUCKET=bucket-name
DATA_TOOL_CLI_COUCHBASE_SCOPE=scope-name
```

## Features

- **Batch Processing**: The clone command processes documents in batches of 100 for better performance
- **Error Handling**: Failed documents are logged but don't stop the entire operation
- **Collection Creation**: Automatically creates collections in the destination if they don't exist
- **Multiple Connections**: Supports connecting to different Couchbase instances simultaneously
- **Type Filtering**: Clone specific document types within collections using the `collection:type` format
