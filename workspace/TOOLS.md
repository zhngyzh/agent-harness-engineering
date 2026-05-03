# TOOLS.md — Available Tools

## File Tools
| Tool | When to use | When NOT to use |
|------|------------|-----------------|
| `read_file` | Reading file contents | Listing directories, executing commands |
| `write_file` | Creating new files, complete rewrites | Small edits (use edit_file) |
| `edit_file` | Precise text replacements | Creating new files (use write_file) |
| `list_directory` | Exploring workspace structure | Reading file contents |

## System Tools
| Tool | When to use | When NOT to use |
|------|------------|-----------------|
| `bash` | Running commands, scripts, file operations via shell | Simple file read/write (use dedicated tools) |

## Guidelines
- Always read a file before editing it
- Use absolute paths when possible
- For long-running commands, set an appropriate timeout
- Check if a file exists before trying to edit it
