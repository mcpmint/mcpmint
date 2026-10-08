"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, FileJson, Link2, FileCode2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProjectStore } from "@/store/project-store";
import { useProcessing } from "@/hooks/use-processing";
import type { PreparedImport } from "@/lib/processing/types";
import { MAX_SPEC_BYTES } from "@/lib/processing/limits";

export function SpecDropzone() {
    const { run, runURL } = useProcessing();
    const [url, setUrl] = useState("");
    const [pastedContent, setPastedContent] = useState("");
    const { setSpec, setLoading, setError, isLoading, error } = useProjectStore();

    const handleFileParse = useCallback(
        async (file: File) => {
            setLoading(true);
            setError(null);

            try {
                const prepared = await run<PreparedImport>({ action: "parse", file, filename: file.name });
                setSpec(prepared.spec, file.name, prepared);
            } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to parse file");
            } finally {
                setLoading(false);
            }
        },
        [setSpec, setLoading, setError, run]
    );

    const handleURLParse = useCallback(async () => {
        if (!url.trim()) return;

        setLoading(true);
        setError(null);

        try {
            const prepared = await runURL<PreparedImport>(url);
            setSpec(prepared.spec, url, prepared);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to fetch spec");
        } finally {
            setLoading(false);
        }
    }, [url, setSpec, setLoading, setError, runURL]);

    const handlePasteParse = useCallback(async () => {
        if (!pastedContent.trim()) return;

        setLoading(true);
        setError(null);

        try {
            const prepared = await run<PreparedImport>({ action: "parse", content: pastedContent, filename: "pasted-spec" });
            setSpec(prepared.spec, "Pasted Content", prepared);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to parse content");
        } finally {
            setLoading(false);
        }
    }, [pastedContent, setSpec, setLoading, setError, run]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        accept: {
            "application/json": [".json"],
            "application/x-yaml": [".yaml", ".yml"],
            "text/yaml": [".yaml", ".yml"],
        },
        maxFiles: 1,
        maxSize: MAX_SPEC_BYTES,
        onDropRejected: () => setError("Choose one JSON/YAML specification up to 5 MB."),
        onDrop: (files) => {
            if (files[0]) {
                handleFileParse(files[0]);
            }
        },
    });

    return (
        <div className="w-full max-w-2xl mx-auto">
            <Tabs defaultValue="upload" className="w-full">
                <TabsList className="grid w-full grid-cols-3 glass mb-6">
                    <TabsTrigger value="upload" className="data-[state=active]:bg-primary/20">
                        <Upload className="w-4 h-4 mr-2" />
                        Upload
                    </TabsTrigger>
                    <TabsTrigger value="url" className="data-[state=active]:bg-primary/20">
                        <Link2 className="w-4 h-4 mr-2" />
                        URL
                    </TabsTrigger>
                    <TabsTrigger value="paste" className="data-[state=active]:bg-primary/20">
                        <FileCode2 className="w-4 h-4 mr-2" />
                        Paste
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="upload">
                    <div
                        {...getRootProps()}
                        className={`
              glass p-12 cursor-pointer transition-all duration-200
              border-2 border-dashed
              ${isDragActive
                                ? "border-primary bg-primary/10"
                                : "border-white/10 hover:border-white/20 hover:bg-white/[0.02]"
                            }
            `}
                    >
                        <input {...getInputProps()} />
                        <div className="flex flex-col items-center text-center">
                            {isLoading ? (
                                <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
                            ) : (
                                <FileJson className="w-12 h-12 text-primary/80 mb-4" />
                            )}
                            <p className="text-lg font-medium text-foreground mb-2">
                                {isDragActive ? "Drop your spec here" : "Drag & drop your API spec"}
                            </p>
                            <p className="text-sm text-muted-foreground">
                                Supports OpenAPI 3.x and Swagger 2.0 (.json, .yaml)
                            </p>
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="url">
                    <div className="glass p-6 space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-foreground">
                                Spec URL
                            </label>
                            <Input
                                type="url"
                                placeholder="https://api.example.com/openapi.json"
                                value={url}
                                onChange={(e) => setUrl(e.target.value)}
                                className="glass border-white/10 focus:border-primary/50"
                            />
                        </div>
                        <Button
                            onClick={handleURLParse}
                            disabled={!url.trim() || isLoading}
                            className="w-full bg-primary hover:bg-primary/90"
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Fetching...
                                </>
                            ) : (
                                <>
                                    <Link2 className="w-4 h-4 mr-2" />
                                    Fetch Spec
                                </>
                            )}
                        </Button>
                        <p className="text-xs text-muted-foreground text-center">
                            Try: https://petstore3.swagger.io/api/v3/openapi.json
                        </p>
                    </div>
                </TabsContent>

                <TabsContent value="paste">
                    <div className="glass p-6 space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-foreground">
                                Paste JSON or YAML
                            </label>
                            <textarea
                                placeholder='{"openapi": "3.0.0", ...}'
                                value={pastedContent}
                                onChange={(e) => setPastedContent(e.target.value)}
                                className="w-full h-48 px-3 py-2 bg-white/5 border border-white/10 
                         focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/50
                         text-sm font-mono text-foreground placeholder:text-muted-foreground resize-none"
                            />
                        </div>
                        <Button
                            onClick={handlePasteParse}
                            disabled={!pastedContent.trim() || isLoading}
                            className="w-full bg-primary hover:bg-primary/90"
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Parsing...
                                </>
                            ) : (
                                <>
                                    <FileCode2 className="w-4 h-4 mr-2" />
                                    Parse Spec
                                </>
                            )}
                        </Button>
                    </div>
                </TabsContent>
            </Tabs>

            {error && (
                <div className="mt-4 p-4 bg-destructive/10 border border-destructive/30 text-destructive text-sm">
                    {error}
                </div>
            )}
        </div>
    );
}
