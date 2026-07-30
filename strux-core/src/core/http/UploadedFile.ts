import fs from "fs";
import path from "path";
import crypto from "crypto";

export class UploadedFile {
    public filename: string;
    public originalName: string;
    public mimeType: string;
    public size: number;
    public buffer: Buffer;

    constructor(fileData: { filename: string; originalName?: string; mimeType: string; size?: number; buffer: Buffer }) {
        this.originalName = fileData.originalName || fileData.filename;
        this.filename = fileData.filename;
        this.mimeType = fileData.mimeType;
        this.buffer = fileData.buffer;
        this.size = fileData.size || fileData.buffer.length;
    }

    /**
     * Get the original filename extension (e.g. 'png', 'jpg')
     */
    public extension(): string {
        const ext = path.extname(this.originalName);
        return ext ? ext.substring(1).toLowerCase() : "";
    }

    /**
     * Inspect file binary magic bytes to detect the authentic MIME type & extension
     */
    public detectRealType(): { mime: string; ext: string; isFakeExtension: boolean } {
        if (!this.buffer || this.buffer.length < 4) {
            const ext = this.extension();
            return { mime: this.mimeType, ext, isFakeExtension: false };
        }

        const header = this.buffer.subarray(0, 12);
        let realExt = "";
        let realMime = "";

        // 1. PNG: 89 50 4E 47
        if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47) {
            realExt = "png";
            realMime = "image/png";
        }
        // 2. JPEG: FF D8 FF
        else if (header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF) {
            realExt = "jpg";
            realMime = "image/jpeg";
        }
        // 3. GIF: 47 49 46 38 ('GIF8')
        else if (header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x38) {
            realExt = "gif";
            realMime = "image/gif";
        }
        // 4. WEBP: RIFF...WEBP
        else if (header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46 &&
                 header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50) {
            realExt = "webp";
            realMime = "image/webp";
        }
        // 5. PDF: %PDF (25 50 44 46)
        else if (header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46) {
            realExt = "pdf";
            realMime = "application/pdf";
        }
        // 6. ZIP / DOCX / XLSX: PK.. (50 4B 03 04)
        else if (header[0] === 0x50 && header[1] === 0x4B && header[2] === 0x03 && header[3] === 0x04) {
            realExt = "zip";
            realMime = "application/zip";
        }
        // 7. EXE / DLL: MZ (4D 5A)
        else if (header[0] === 0x4D && header[1] === 0x5A) {
            realExt = "exe";
            realMime = "application/x-msdownload";
        }
        // 8. ELF / Executable: .ELF (7F 45 4C 46)
        else if (header[0] === 0x7F && header[1] === 0x45 && header[2] === 0x4C && header[3] === 0x46) {
            realExt = "elf";
            realMime = "application/x-executable";
        }
        else {
            realExt = this.extension();
            realMime = this.mimeType;
        }

        const clientExt = this.extension();
        const normalizedClientExt = clientExt === "jpeg" ? "jpg" : clientExt;
        const isFakeExtension = Boolean(clientExt && realExt && normalizedClientExt !== realExt);

        return { mime: realMime, ext: realExt, isFakeExtension };
    }

    /**
     * Get real binary file extension (e.g. 'png', 'jpg', 'pdf', 'exe')
     */
    public realExtension(): string {
        return this.detectRealType().ext;
    }

    /**
     * Get real binary MIME type (e.g. 'image/png', 'application/pdf')
     */
    public realMimeType(): string {
        return this.detectRealType().mime;
    }

    /**
     * Check if client-provided filename extension is fake or spoofed
     */
    public isFakeExtension(): boolean {
        return this.detectRealType().isFakeExtension;
    }

    /**
     * Check if the file upload is valid and not empty
     */
    public isValid(): boolean {
        return Boolean(this.buffer && this.buffer.length > 0);
    }

    /**
     * Store uploaded file to storage/app/public directory
     * Returns the web-accessible relative path (e.g. 'storage/avatars/a1b2c3.png')
     */
    public async store(targetDir = "uploads", customFilename?: string): Promise<string> {
        const cleanDir = targetDir.replace(/^storage[/\\]/, "").replace(/^public[/\\]/, "");

        const absoluteDir = path.isAbsolute(targetDir)
            ? targetDir
            : path.join(process.cwd(), "storage", "app", "public", cleanDir);

        if (!fs.existsSync(absoluteDir)) {
            fs.mkdirSync(absoluteDir, { recursive: true });
        }

        const ext = this.realExtension() || this.extension();
        const generatedName = customFilename || `${crypto.randomBytes(16).toString("hex")}${ext ? "." + ext : ""}`;
        const targetPath = path.join(absoluteDir, generatedName);

        await fs.promises.writeFile(targetPath, this.buffer);

        return path.join("storage", cleanDir, generatedName);
    }

    /**
     * Store uploaded file with custom filename
     */
    public async storeAs(targetDir: string, customFilename: string): Promise<string> {
        return await this.store(targetDir, customFilename);
    }
}
