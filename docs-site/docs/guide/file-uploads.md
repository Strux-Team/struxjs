# File Uploads & Storage Management

StruxJS provides a file handling engine with magic-byte MIME type inspection, file validation rules, public storage linking, and storage permission management.

---

## File Upload Handling

Access uploaded files using `request.file()` or `request.files()` in Controller action methods.

### Single File Upload

```typescript
import { Request, Response } from "struxjs";

export class ProfileController {
    public async uploadAvatar(request: Request, response: Response) {
        // Validate incoming file
        await request.validate({
            avatar: "required|file|image|max:2048" // Max 2MB authentic image
        });

        const avatar = request.file("avatar");

        if (avatar && avatar.isValid()) {
            // Save file into storage/app/public/avatars
            const publicPath = await avatar.store("avatars");
            
            return response.json({
                success: true,
                url: `/${publicPath}` // Returns: "/storage/avatars/a1b2c3.jpg"
            });
        }

        return response.status(400).json({ error: "No valid file uploaded" });
    }
}
```

### Multiple File Uploads

Use `request.files("fieldname")` to retrieve an array of `UploadedFile` instances:

```typescript
export class GalleryController {
    public async uploadPhotos(request: Request, response: Response) {
        const photos = request.files("photos");
        const savedPaths: string[] = [];

        for (const photo of photos) {
            if (photo.isValid()) {
                const path = await photo.store("gallery");
                savedPaths.push(path);
            }
        }

        return response.json({ savedPaths });
    }
}
```

---

## `UploadedFile` API Reference

Each uploaded file is wrapped in an `UploadedFile` instance:

### Properties
* `file.originalName`: Original client-side filename (e.g. `"portrait.jpg"`).
* `file.filename`: Temporary uploaded filename.
* `file.mimeType`: Client-reported MIME type string (e.g. `"image/jpeg"`).
* `file.size`: Uploaded file size in bytes.
* `file.buffer`: Raw binary `Buffer` object.

### Methods

#### `file.store(targetDir?, customFilename?)`
Saves the uploaded file into `storage/app/public/${targetDir}` and returns the web-accessible relative path (e.g. `"storage/avatars/filename.png"`). If `customFilename` is omitted, a random hexadecimal filename is generated.

```typescript
const filePath = await file.store("avatars");
```

#### `file.storeAs(targetDir, customFilename)`
Saves the file into `storage/app/public/${targetDir}` with a specified filename:

```typescript
const filePath = await file.storeAs("documents", "User_Contract_42.pdf");
```

#### `file.realMimeType()`
Inspects the binary magic bytes of the file buffer to determine its authentic MIME type, protecting against file extension spoofing.

```typescript
const mime = file.realMimeType(); // e.g. "image/png"
```

#### `file.realExtension()`
Returns the real file extension detected from binary magic bytes (e.g. `"png"`, `"jpg"`, `"pdf"`, `"zip"`).

```typescript
const ext = file.realExtension();
```

#### `file.isFakeExtension()`
Returns `true` if the client-provided file extension does not match the actual binary content (e.g. an executable `.exe` file renamed to `.png`).

```typescript
if (file.isFakeExtension()) {
    throw new Error("File extension spoofing detected.");
}
```

#### `file.isValid()`
Returns `true` if the file buffer is non-empty and valid.

---

## Storage Symbolic Link (`storage:link`)

By default, files saved using `file.store()` are placed inside `storage/app/public/`. To make these files publicly accessible via the web server at `http://localhost:3000/storage/...`, create a symbolic link connecting `public/storage` to `storage/app/public`.

Run the CLI command:

```bash
npx strux storage:link
```

Or via bootstrap CLI:

```bash
node bootstrap-cli.js storage:link
```

This command creates a symlink:

```
public/storage ──> storage/app/public
```

Once linked, a file stored at `storage/app/public/avatars/photo.png` is served at:

```
http://localhost:3000/storage/avatars/photo.png
```

---

## Production Permissions & Chmod Guide

On Linux and production servers (Ubuntu, Nginx, Apache), the web server process user (such as `www-data` or `nginx`) must have write permissions to `storage/` and `bootstrap/cache/` directories to handle file uploads, session files, caches, and logs.

### 1. Set Directory Ownership

Set the web server user (`www-data`) as owner of the application storage and cache directories:

```bash
sudo chown -R www-data:www-data storage
```

If your user needs write access alongside `www-data`, add your user to the web server group:

```bash
sudo usermod -a -G www-data $USER
sudo chown -R $USER:www-data storage
```

### 2. Set Directory & File Permissions (`chmod`)

Set read, write, and execute permissions (775 for directories, 664 for files):

```bash
# Set directory permissions
sudo find storage -type d -exec chmod 775 {} \;

# Set file permissions
sudo find storage -type f -exec chmod 664 {} \;
```

### 3. Verify Storage Link Permissions

Ensure the `public/` directory allows symbolic link traversal:

```bash
chmod 755 public
```
