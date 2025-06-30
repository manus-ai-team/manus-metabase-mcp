# Metabase MCP Server

**Original Author**: Hyeongjun Yu (@hyeongjun-dev)

**Forked & Modified by**: Jericho Sequitin (@jerichosequitin)

> This is a customized fork of the original [metabase-mcp-server](https://github.com/hyeongjun-dev/metabase-mcp-server) with additional features and modifications.

A Model Context Protocol server that integrates AI assistants with Metabase analytics platform.

## Overview

This TypeScript-based MCP server provides seamless integration with the Metabase API, enabling AI assistants to directly interact with your analytics data. Designed for Claude and other MCP-compatible AI assistants, this server acts as a bridge between your analytics platform and conversational AI.

### Key Features

- **Resource Access**: Navigate Metabase resources via intuitive `metabase://` URIs
- **Two Authentication Methods**: Support for both session-based and API key authentication
- **Structured Data Access**: JSON-formatted responses for easy consumption by AI assistants
- **Comprehensive Logging**: Detailed logging for easy debugging and monitoring
- **Error Handling**: Robust error handling with clear error messages
- **Custom Modifications**: Enhanced with additional features and improvements

## Available Tools

The server exposes the following tools for AI assistants:

### Core Tools
- `list_dashboards`: Retrieve all available dashboards in your Metabase instance
- `list_cards`: Get all saved questions/cards in Metabase
- `list_databases`: View all connected database sources
- `get_dashboard_cards`: Extract all cards from a specific dashboard

### Query Execution Tools
- `execute_query`: **[RECOMMENDED]** Execute custom SQL queries against any connected database (2K row limit)
- `execute_card`: **[DEPRECATED]** Run saved questions with optional parameters (unreliable, use get_card_sql + execute_query instead)
- `get_card_sql`: **[RECOMMENDED]** Get the SQL query and database details from a Metabase card/question

### Search Tools
- `search_cards`: Search for questions/cards by name, ID, or SQL content
- `search_dashboards`: Search for dashboards by name or ID

### Export Tools
- `export_query`: Export large SQL query results using Metabase export endpoints (supports up to 1M rows vs 2K limit of execute_query). Supports CSV, JSON, and XLSX formats with optional file saving.

## Configuration

The server supports two authentication methods:

### Option 1: Username and Password Authentication

```bash
# Required
METABASE_URL=https://your-metabase-instance.com
METABASE_USER_EMAIL=your_email@example.com
METABASE_PASSWORD=your_password

# Optional
LOG_LEVEL=info # Options: debug, info, warn, error, fatal
```

### Option 2: API Key Authentication (Recommended for Production)

```bash
# Required
METABASE_URL=https://your-metabase-instance.com
METABASE_API_KEY=your_api_key

# Optional
LOG_LEVEL=info # Options: debug, info, warn, error, fatal
```

You can set these environment variables directly or use a `.env` file with [dotenv](https://www.npmjs.com/package/dotenv).

## Installation

### Prerequisites

- Node.js 18.0.0 or higher
- An active Metabase instance with appropriate credentials

### Development Setup

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Start the server
npm start

# For development with auto-rebuild
npm run watch
```

### Claude Desktop Integration

To use with Claude Desktop, add this server configuration:

**MacOS**: Edit `~/Library/Application Support/Claude/claude_desktop_config.json`

**Windows**: Edit `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "metabase-mcp-server": {
      "command": "/absolute/path/to/metabase-mcp-server/build/index.js",
      "env": {
        "METABASE_URL": "https://your-metabase-instance.com",
        "METABASE_USER_EMAIL": "your_email@example.com",
        "METABASE_PASSWORD": "your_password"
        // Or alternatively, use API key authentication
        // "METABASE_API_KEY": "your_api_key"
      }
    }
  }
}
```

Alternatively, you can use the Smithery hosted version via npx with JSON configuration:

#### API Key Authentication:

```json
{
  "mcpServers": {
    "metabase-mcp-server": {
      "command": "npx",
      "args": [
        "-y",
        "@smithery/cli@latest",
        "run",
        "@hyeongjun-dev/metabase-mcp-server",
        "--config",
        "{\"metabaseUrl\":\"https://your-metabase-instance.com\",\"metabaseApiKey\":\"your_api_key\",\"metabasePassword\":\"\",\"metabaseUserEmail\":\"\"}"
      ]
    }
  }
}
```

#### Username and Password Authentication:

```json
{
  "mcpServers": {
    "metabase-mcp-server": {
      "command": "npx",
      "args": [
        "-y",
        "@smithery/cli@latest",
        "run",
        "@hyeongjun-dev/metabase-mcp-server",
        "--config",
        "{\"metabaseUrl\":\"https://your-metabase-instance.com\",\"metabaseApiKey\":\"\",\"metabasePassword\":\"your_password\",\"metabaseUserEmail\":\"your_email@example.com\"}"
      ]
    }
  }
}
```

## Custom Modifications

This fork includes the following enhancements:

### Implemented Features
- [x] **Enhanced Search Functionality**: Added `search_cards` and `search_dashboards` tools with support for name, ID, and SQL content search
- [x] **SQL Query Extraction**: Added `get_card_sql` tool to extract SQL queries from Metabase cards for modification and reuse
- [x] **Data Export**: Added `export_query` tool supporting CSV, JSON, and XLSX formats with up to 1M row capacity

### Tool Enhancements

#### Search Tools
- **Auto-detection**: Automatically detects search type (name, ID, or content) based on query pattern
- **SQL Content Search**: Search within SQL queries of saved cards
- **Enhanced Results**: Provides SQL previews and recommended workflows for AI agents

#### Export Tools
- **Multiple Formats**: Support for CSV, JSON, and XLSX export formats
- **High Capacity**: Up to 1 million rows (vs 2,000 row limit of standard queries)
- **File Management**: Automatic file saving to Downloads folder with error handling
- **Custom Filenames**: Support for custom filename specification
- **Progress Feedback**: Clear status messages and fallback instructions

#### Query Execution
- **SQL Extraction**: Get SQL queries from existing cards for modification
- **Parameter Support**: Enhanced parameter handling with proper type detection
- **Reliability**: Deprecated unreliable `execute_card` in favor of `get_card_sql` + `execute_query` workflow

## Usage Examples

### Search for Cards
```javascript
// Search by name
search_cards({ query: "sales dashboard" })

// Search by ID
search_cards({ query: "42" })

// Search by SQL content
search_cards({ query: "SELECT * FROM orders" })
```

### Extract and Modify SQL Queries
```javascript
// 1. Get SQL from existing card
get_card_sql({ card_id: 42 })

// 2. Execute with modifications
execute_query({
  database_id: 1,
  query: "SELECT * FROM users WHERE created_at > '2024-01-01' LIMIT 1000"
})
```

### Export Large Datasets
```javascript
// Export as CSV with auto-save
export_query({
  database_id: 1,
  query: "SELECT * FROM large_table",
  format: "csv",
  save_file: true,
  filename: "large_export"
})

// Export as Excel file
export_query({
  database_id: 1,
  query: "SELECT * FROM sales_data",
  format: "xlsx",
  save_file: true
})

// Export as JSON for API integration
export_query({
  database_id: 1,
  query: "SELECT id, name, email FROM users",
  format: "json"
})
```

## Debugging

Since MCP servers communicate over stdio, use the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) for debugging:

```bash
npm run inspector
```

The Inspector will provide a browser-based interface for monitoring requests and responses.

## Security Considerations

- We recommend using API key authentication for production environments
- Keep your API keys and credentials secure
- Consider using Docker secrets or environment variables instead of hardcoding credentials
- Apply appropriate network security measures to restrict access to your Metabase instance


## Original Project

This project is based on the original work by Hyeongjun Yu. You can find the original repository at:
https://github.com/hyeongjun-dev/metabase-mcp-server

## License

This project maintains the same license as the original project.
