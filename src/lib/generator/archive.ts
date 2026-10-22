import { strToU8, zipSync } from "fflate";
import type { GeneratedProject } from "./types.ts";

// Defense-in-depth against Zip Slip / traversal (finding M1/R7). The caller
// derives rootFolder from user-controlled serverConfig.name, which request
// validation already restricts to a safe charset. We sanitize again here so
// the archive layer is safe regardless of how it is invoked: strip path
// separators and ".." segments, and fall back to a constant if nothing safe
// remains. The same value is safe for a Content-Disposition filename.
export function sanitizeRootFolder(rootFolder: string): string {
    const cleaned = rootFolder
        .replace(/[\\/]+/g, "-")
        .replace(/\.\.+/g, "-")
        .replace(/[^a-zA-Z0-9._-]/g, "-")
        .replace(/^[.-]+/, "")
        .slice(0, 64);

    return cleaned.length > 0 ? cleaned : "mcp-server";
}

// fflate is pure JavaScript, so the server route and the browser worker build
// byte-identical archives with one implementation.
export function zipGeneratedProject(project: GeneratedProject, rootFolder: string): Uint8Array {
    const safeRootFolder = sanitizeRootFolder(rootFolder);
    const zipInput: Record<string, Uint8Array> = {};
    for (const [filePath, content] of project.files) {
        zipInput[`${safeRootFolder}/${filePath}`] = strToU8(content);
    }
    return zipSync(zipInput, { level: 6 });
}
