export interface Guide {
  slug: string;
  title: string;
  description: string;
  sections: { title: string; paragraphs: string[]; steps?: string[] }[];
}
export const guides: Guide[] = [
  {
    slug: "openapi-to-mcp",
    title: "Convert OpenAPI and Swagger to an MCP server",
    description:
      "Import an API contract, choose tools, and export a TypeScript or Python Model Context Protocol server with mcpmint.",
    sections: [
      {
        title: "What mcpmint generates",
        paragraphs: [
          "mcpmint turns an API contract into source code for a Model Context Protocol (MCP) server. MCP lets compatible AI clients discover tools and call them through a standard interface. Your generated server translates tool arguments into upstream HTTP requests; the upstream API remains responsible for its own authorization and business rules.",
          "Import OpenAPI 3.x or Swagger 2.0 as JSON or YAML. mcpmint normalizes operations, parameters, request bodies, responses and authentication information. Feature support varies by operation: inspect the capabilities panel and validation warnings before using generated code.",
        ],
      },
      {
        title: "From contract to source code",
        paragraphs: [
          "Files and pasted specifications are processed locally in a dedicated browser worker. URL import asks the mcpmint server to fetch the URL you provide. External references are never fetched automatically; bundle referenced documents into a single specification first.",
        ],
        steps: [
          "Open Import and choose a JSON/YAML file, paste a contract, or enter a public specification URL.",
          "Review the import warnings and select the endpoints you want to expose as tools. The recommended preset favors supported read operations.",
          "Choose TypeScript with the MCP TypeScript SDK or Python with FastMCP. Configure the server name, upstream authentication and MCP transport.",
          "Inspect a generated preview and the Trust Scan. A red scan requires explicit acknowledgement before download.",
          "Download the ZIP, inspect the generated README and source, install dependencies, and configure credentials locally.",
        ],
      },
      {
        title: "Review schema and authentication details",
        paragraphs: [
          "Recursive local references are retained as finite schema references. Complex schemas, content negotiation and unsupported authentication combinations may require manual changes. A successful import or a green scan is not a promise that every upstream request is correct.",
          "Upstream API authentication and access to your MCP server are separate settings. Do not embed API keys in a specification, tool description or portable project file. Supply real credentials to the generated server through its documented environment variables.",
        ],
      },
    ],
  },
  {
    slug: "postman-to-mcp",
    title: "Convert a Postman collection to MCP",
    description:
      "Use a Postman v2.x collection as the starting point for inspectable MCP tools and exported server code.",
    sections: [
      {
        title: "Import a collection",
        paragraphs: [
          "Export a Postman v2.x collection as JSON and import it through mcpmint. Requests and folders become an operation catalog you can inspect and select. Request URLs, methods, parameters, bodies and supported authentication are normalized into the same model used for OpenAPI imports.",
          "A collection may contain concrete examples rather than complete schemas. Postman scripts, environment execution and pre-request logic are not a Postman runtime inside the generated MCP server. Review inferred inputs, unresolved variables and validation warnings, and implement any necessary behavior in the exported source.",
        ],
      },
      {
        title: "Prepare the collection safely",
        paragraphs: [
          "Remove tokens, cookies and passwords before importing or sharing a collection. Replace private values with placeholders and configure the upstream base URL and authentication in the generated server's environment.",
        ],
        steps: [
          "Export the collection as JSON, keeping it under the 5 MiB specification limit.",
          "Import the file and inspect the capabilities and endpoint warnings.",
          "Rename tools and clarify descriptions so an AI client can choose the right operation.",
          "Select no more than 500 tools, preview the code and run local request mocks.",
          "Export TypeScript or Python, review the README and test against a development API before connecting an AI client.",
        ],
      },
      {
        title: "Understand live tests",
        paragraphs: [
          "Inspection and mocks stay in your browser. Run live requests locally using the CLI or generated server against a development API. The CLI requires explicit permission for mutations. Inspect the outgoing request and review authentication before testing.",
        ],
      },
    ],
  },
  {
    slug: "privacy",
    title: "Privacy, browser storage and Trust Scan",
    description:
      "Understand which actions stay local, when mcpmint uses the network, and the limits of automated tool scanning.",
    sections: [
      {
        title: "Local processing by default",
        paragraphs: [
          "Uploading a local file or pasting a specification does not send that specification to the mcpmint server. Parsing, normalization, preview and ZIP generation run in a dedicated browser worker. Browser generation is enabled by default on Export.",
          "URL import sends the URL you enter to /api/fetch-spec, which retrieves the public document using bounded, SSRF-protected requests. Disabling browser generation sends the configured API model and selected tools to /api/generate. These are explicit network paths, not private-mode parsing.",
          "External schema references are not fetched automatically. Bundle them locally before import. The website also loads its font stylesheet and aggregate Vercel analytics; local processing refers to the specification workflow, not an entirely offline website.",
        ],
      },
      {
        title: "Saved work stays in this browser",
        paragraphs: [
          "Working sessions and named projects use IndexedDB on the current site origin. Existing localStorage projects migrate when loaded. This is local browser storage, not account synchronization or encrypted cloud backup. Browser settings, private browsing, device cleanup or a domain change can remove or separate it.",
          "Export a portable project file for a backup or to move work between browsers. Project files contain the API model and tool configuration, including examples and descriptions: treat them as sensitive if the original specification is sensitive. A visible storage error means you should keep the tab open and export before leaving.",
          "Configure credentials locally through the generated environment template or MCP client. The browser sandbox inspects requests and runs mocks without accepting or sending upstream credentials.",
        ],
      },
      {
        title: "What the Trust Scan establishes",
        paragraphs: [
          "The Trust Scan checks tool descriptions and schemas for suspicious instructions, parameters, broad permissions and risky combinations. Its findings are heuristics. It cannot prove that an API is safe, that documentation is truthful, or that generated code has no vulnerabilities.",
          "Read red and yellow findings, inspect the exported source and use the least privilege appropriate for your upstream. A downloaded attestation records the scan and a digest of the inspected tool definitions; it is not a security certification.",
        ],
      },
    ],
  },
  {
    slug: "limits",
    title: "Import limits and large API workflows",
    description:
      "File size, schema complexity, selected-tool and live-response limits for mcpmint browser processing.",
    sections: [
      {
        title: "Processing budgets",
        paragraphs: [
          "Specifications are limited to 5 MiB of UTF-8 content on every import path, including paste and Update spec. File imports accept JSON, YAML and YML. Portable project files have a separate 20 MiB limit because they also contain normalized models and tool settings.",
          "An import can contain up to 10,000 operations. Each generated server can contain at most 500 selected tools, including compact mode. Default and bulk selection stop at 500; split larger exports into separate servers. Structural budgets also reject deeply nested or excessively expanded schemas before they exhaust browser memory.",
          "Processing tasks run in a worker, show their current stage and can be cancelled. A task that exceeds 60 seconds is terminated. The editor displays 100 endpoints per page, while filtering and selection presets operate on the full matching catalog.",
        ],
      },
      {
        title: "Compact mode and large catalogs",
        paragraphs: [
          "Compact mode exposes list, schema lookup and invocation meta-tools instead of sending every selected tool definition to the AI client at once. It reduces the tool context presented to a model; it does not bypass import or export workload limits.",
          "Local CLI live tests time out after 10 seconds and stop reading after 256 KiB of response bytes. Browser inspection and mocks send no API requests. Use the generated server to verify edited tools and authentication.",
        ],
      },
      {
        title: "When an import fails",
        paragraphs: [
          "Reduce a very large specification to the operations you need, bundle external references locally, and remove unnecessary examples or deeply expanded schemas. For an unreadable or damaged file, export it again from its original source. A visible import error leaves the previous working project available.",
          "Memory and storage availability depend on the browser and device. Save a portable project backup before replacing a specification, clearing site data or moving to another production domain.",
        ],
      },
    ],
  },
  {
    slug: "deployment",
    title: "Run and deploy an exported MCP server",
    description:
      "Choose an MCP transport, configure local credentials, and verify the generated TypeScript or Python server before deployment.",
    sections: [
      {
        title: "Start with the generated README",
        paragraphs: [
          "Download and unzip the generated project, inspect its source and follow its README for the chosen runtime. TypeScript exports use the MCP TypeScript SDK; Python exports use FastMCP. Installation instructions depend on the selected runtime, package manager and transport.",
          "The web app performs bounded structural validation. It does not spawn build or test processes for uploaded projects. Run the generated project's tests and build locally; the mcpmint CLI and repository verification workflow provide local full verification where supported.",
        ],
      },
      {
        title: "Choose a transport and access policy",
        paragraphs: [
          "Use stdio when an MCP client launches the server as a local process. Use Streamable HTTP or SSE when running a separately hosted service and configure the client for that transport. The Export installation wizard provides connection configuration for supported clients.",
          "For HTTP or SSE, bind to localhost during development. Before exposing a network listener, configure MCP bearer access with MCP_AUTH_TOKEN and appropriate allowed origins. Generated servers deny non-localhost Origin headers by default when the allow-list is empty. Origin checks complement authentication; they do not replace it.",
          "Configure upstream authentication separately using the generated environment template. Keep secret values out of NEXT_PUBLIC_ variables, specifications, portable project files and source control. Deploy behind HTTPS and apply upstream request permissions suitable for the selected tools.",
        ],
      },
      {
        title: "Verify before connecting an agent",
        paragraphs: [
          "Inspect the outgoing request with the browser sandbox, run mocks and test real requests locally against a development API. Review schema conversion warnings, authentication selection and state-changing methods. Use the least privilege possible and monitor the deployed server.",
          "If you deploy the mcpmint website itself, set NEXT_PUBLIC_SITE_URL to the actual HTTPS origin before building. The website uses server API routes and security headers, so it requires a Next.js server or compatible platform; it is not a pure static export. The repository deployment verification guide covers crawler access and search indexing checks.",
        ],
      },
    ],
  },
];
