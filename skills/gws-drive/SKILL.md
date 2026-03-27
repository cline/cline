---
name: gws-drive
version: 1.0.0
description: "Google Drive: Manage files, folders, and shared drives."
metadata:
  openclaw:
    category: "productivity"
    requires:
      bins: ["gws"]
    cliHelp: "gws drive --help"
---

# drive (v3)

> **PREREQUISITE:** Read `../gws-shared/SKILL.md` for auth, global flags, and security rules. If missing, run `gws generate-skills` to create it.

```bash
gws drive <resource> <method> [flags]
```

## Helper Commands

| Command | Description |
|---------|-------------|
| [`+upload`](../gws-drive-upload/SKILL.md) | Upload a file with automatic metadata |

## API Resources

### about

  - `get` — Gets information about the user, the user's Drive, and system capabilities. For more information, see [Return user info](https://developers.google.com/workspace/drive/api/guides/user-info). Required: The `fields` parameter must be set. To return the exact fields you need, see [Return specific fields](https://developers.google.com/workspace/drive/api/guides/fields-parameter).

### accessproposals

  - `get` — Retrieves an access proposal by ID. For more information, see [Manage pending access proposals](https://developers.google.com/workspace/drive/api/guides/pending-access).
  - `list` — List the access proposals on a file. For more information, see [Manage pending access proposals](https://developers.google.com/workspace/drive/api/guides/pending-access). Note: Only approvers are able to list access proposals on a file. If the user isn't an approver, a 403 error is returned.
  - `resolve` — Approves or denies an access proposal. For more information, see [Manage pending access proposals](https://developers.google.com/workspace/drive/api/guides/pending-access).

### approvals

  - `get` — Gets an Approval by ID.
  - `list` — Lists the Approvals on a file.

### apps

  - `get` — Gets a specific app. For more information, see [Return user info](https://developers.google.com/workspace/drive/api/guides/user-info).
  - `list` — Lists a user's installed apps. For more information, see [Return user info](https://developers.google.com/workspace/drive/api/guides/user-info).

### changes

  - `getStartPageToken` — Gets the starting pageToken for listing future changes. For more information, see [Retrieve changes](https://developers.google.com/workspace/drive/api/guides/manage-changes).
  - `list` — Lists the changes for a user or shared drive. For more information, see [Retrieve changes](https://developers.google.com/workspace/drive/api/guides/manage-changes).
  - `watch` — Subscribes to changes for a user. For more information, see [Notifications for resource changes](https://developers.google.com/workspace/drive/api/guides/push).

### channels

  - `stop` — Stops watching resources through this channel. For more information, see [Notifications for resource changes](https://developers.google.com/workspace/drive/api/guides/push).

### comments

  - `create` — Creates a comment on a file. For more information, see [Manage comments and replies](https://developers.google.com/workspace/drive/api/guides/manage-comments). Required: The `fields` parameter must be set. To return the exact fields you need, see [Return specific fields](https://developers.google.com/workspace/drive/api/guides/fields-parameter).
  - `delete` — Deletes a comment. For more information, see [Manage comments and replies](https://developers.google.com/workspace/drive/api/guides/manage-comments).
  - `get` — Gets a comment by ID. For more information, see [Manage comments and replies](https://developers.google.com/workspace/drive/api/guides/manage-comments). Required: The `fields` parameter must be set. To return the exact fields you need, see [Return specific fields](https://developers.google.com/workspace/drive/api/guides/fields-parameter).
  - `list` — Lists a file's comments. For more information, see [Manage comments and replies](https://developers.google.com/workspace/drive/api/guides/manage-comments). Required: The `fields` parameter must be set. To return the exact fields you need, see [Return specific fields](https://developers.google.com/workspace/drive/api/guides/fields-parameter).
  - `update` — Updates a comment with patch semantics. For more information, see [Manage comments and replies](https://developers.google.com/workspace/drive/api/guides/manage-comments). Required: The `fields` parameter must be set. To return the exact fields you need, see [Return specific fields](https://developers.google.com/workspace/drive/api/guides/fields-parameter).

### drives

  - `create` — Creates a shared drive. For more information, see [Manage shared drives](https://developers.google.com/workspace/drive/api/guides/manage-shareddrives).
  - `get` — Gets a shared drive's metadata by ID. For more information, see [Manage shared drives](https://developers.google.com/workspace/drive/api/guides/manage-shareddrives).
  - `hide` — Hides a shared drive from the default view. For more information, see [Manage shared drives](https://developers.google.com/workspace/drive/api/guides/manage-shareddrives).
  - `list` — Lists the user's shared drives. This method accepts the `q` parameter, which is a search query combining one or more search terms. For more information, see the [Search for shared drives](/workspace/drive/api/guides/search-shareddrives) guide.
  - `unhide` — Restores a shared drive to the default view. For more information, see [Manage shared drives](https://developers.google.com/workspace/drive/api/guides/manage-shareddrives).
  - `update` — Updates the metadata for a shared drive. For more information, see [Manage shared drives](https://developers.google.com/workspace/drive/api/guides/manage-shareddrives).

### files

  - `copy` — Creates a copy of a file and applies any requested updates with patch semantics. For more information, see [Create and manage files](https://developers.google.com/workspace/drive/api/guides/create-file).
  - `create` — Creates a file. For more information, see [Create and manage files](/workspace/drive/api/guides/create-file). This method supports an */upload* URI and accepts uploaded media with the following characteristics: - *Maximum file size:* 5,120 GB - *Accepted Media MIME types:* `*/*` (Specify a valid MIME type, rather than the literal `*/*` value. The literal `*/*` is only used to indicate that any valid MIME type can be uploaded.
  - `download` — Downloads the content of a file. For more information, see [Download and export files](https://developers.google.com/workspace/drive/api/guides/manage-downloads). Operations are valid for 24 hours from the time of creation.
  - `export` — Exports a Google Workspace document to the requested MIME type and returns exported byte content. For more information, see [Download and export files](https://developers.google.com/workspace/drive/api/guides/manage-downloads). Note that the exported content is limited to 10 MB.
  - `generateIds` — Generates a set of file IDs which can be provided in create or copy requests. For more information, see [Create and manage files](https://developers.google.com/workspace/drive/api/guides/create-file).
  - `get` — Gets a file's metadata or content by ID. For more information, see [Search for files and folders](/workspace/drive/api/guides/search-files). If you provide the URL parameter `alt=media`, then the response includes the file contents in the response body. Downloading content with `alt=media` only works if the file is stored in Drive. To download Google Docs, Sheets, and Slides use [`files.export`](/workspace/drive/api/reference/rest/v3/files/export) instead.
  - `list` — Lists the user's files. For more information, see [Search for files and folders](/workspace/drive/api/guides/search-files). This method accepts the `q` parameter, which is a search query combining one or more search terms. This method returns *all* files by default, including trashed files. If you don't want trashed files to appear in the list, use the `trashed=false` query parameter to remove trashed files from the results.
  - `listLabels` — Lists the labels on a file. For more information, see [List labels on a file](https://developers.google.com/workspace/drive/api/guides/list-labels).
  - `modifyLabels` — Modifies the set of labels applied to a file. For more information, see [Set a label field on a file](https://developers.google.com/workspace/drive/api/guides/set-label). Returns a list of the labels that were added or modified.
  - `update` — Updates a file's metadata, content, or both. When calling this method, only populate fields in the request that you want to modify. When updating fields, some fields might be changed automatically, such as `modifiedDate`. This method supports patch semantics. This method supports an */upload* URI and accepts uploaded media with the following characteristics: - *Maximum file size:* 5,120 GB - *Accepted Media MIME types:* `*/*` (Specify a valid MIME type, rather than the literal `*/*` value.
  - `watch` — Subscribes to changes to a file. For more information, see [Notifications for resource changes](https://developers.google.com/workspace/drive/api/guides/push).

### operations

  - `get` — Gets the latest state of a long-running operation. Clients can use this method to poll the operation result at intervals as recommended by the API service.

### permissions

  - `create` — Creates a permission for a file or shared drive. For more information, see [Share files, folders, and drives](https://developers.google.com/workspace/drive/api/guides/manage-sharing). **Warning:** Concurrent permissions operations on the same file aren't supported; only the last update is applied.
  - `delete` — Deletes a permission. For more information, see [Share files, folders, and drives](https://developers.google.com/workspace/drive/api/guides/manage-sharing). **Warning:** Concurrent permissions operations on the same file aren't supported; only the last update is applied.
  - `get` — Gets a permission by ID. For more information, see [Share files, folders, and drives](https://developers.google.com/workspace/drive/api/guides/manage-sharing).
  - `list` — Lists a file's or shared drive's permissions. For more information, see [Share files, folders, and drives](https://developers.google.com/workspace/drive/api/guides/manage-sharing).
  - `update` — Updates a permission with patch semantics. For more information, see [Share files, folders, and drives](https://developers.google.com/workspace/drive/api/guides/manage-sharing). **Warning:** Concurrent permissions operations on the same file aren't supported; only the last update is applied.

### replies

  - `create` — Creates a reply to a comment. For more information, see [Manage comments and replies](https://developers.google.com/workspace/drive/api/guides/manage-comments).
  - `delete` — Deletes a reply. For more information, see [Manage comments and replies](https://developers.google.com/workspace/drive/api/guides/manage-comments).
  - `get` — Gets a reply by ID. For more information, see [Manage comments and replies](https://developers.google.com/workspace/drive/api/guides/manage-comments).
  - `list` — Lists a comment's replies. For more information, see [Manage comments and replies](https://developers.google.com/workspace/drive/api/guides/manage-comments).
  - `update` — Updates a reply with patch semantics. For more information, see [Manage comments and replies](https://developers.google.com/workspace/drive/api/guides/manage-comments).

### revisions

  - `delete` — Permanently deletes a file version. You can only delete revisions for files with binary content in Google Drive, like images or videos. Revisions for other files, like Google Docs or Sheets, and the last remaining file version can't be deleted. For more information, see [Manage file revisions](https://developers.google.com/drive/api/guides/manage-revisions).
  - `get` — Gets a revision's metadata or content by ID. For more information, see [Manage file revisions](https://developers.google.com/workspace/drive/api/guides/manage-revisions).
  - `list` — Lists a file's revisions. For more information, see [Manage file revisions](https://developers.google.com/workspace/drive/api/guides/manage-revisions). **Important:** The list of revisions returned by this method might be incomplete for files with a large revision history, including frequently edited Google Docs, Sheets, and Slides. Older revisions might be omitted from the response, meaning the first revision returned may not be the oldest existing revision.
  - `update` — Updates a revision with patch semantics. For more information, see [Manage file revisions](https://developers.google.com/workspace/drive/api/guides/manage-revisions).

### teamdrives

  - `create` — Deprecated: Use `drives.create` instead.
  - `get` — Deprecated: Use `drives.get` instead.
  - `list` — Deprecated: Use `drives.list` instead.
  - `update` — Deprecated: Use `drives.update` instead.

## Discovering Commands

Before calling any API method, inspect it:

```bash
# Browse resources and methods
gws drive --help

# Inspect a method's required params, types, and defaults
gws schema drive.<resource>.<method>
```

Use `gws schema` output to build your `--params` and `--json` flags.

