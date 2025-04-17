import { glob, type Loader, type LoaderContext } from "astro/loaders";
import { defineCollection, z } from "astro:content";

const blog = defineCollection({
  loader: glob({ base: "./src/content/blog", pattern: "**/*.{md,mdx}" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    heroImage: z.string().optional(),
  }),
});

const docs = defineCollection({
  loader: await ollamaDocsLoader({
    repo: "ollama/ollama",
    path: "docs",
  }),
  schema: z.object({
    name: z.string(),
    path: z.string(),
    sha: z.string(),
    size: z.number(),
    url: z.string(),
    html_url: z.string(),
    git_url: z.string(),
    download_url: z.string(),
    type: z.string(),
    content: z.string(),
    encoding: z.string(),
    _links: z.object({
      self: z.string(),
      git: z.string(),
      html: z.string(),
    }),
  }),
});

export const collections = { blog, docs };

async function ollamaDocsLoader(options: {
  repo: string;
  path: string;
}): Promise<Loader> {
  const { repo, path } = options;

  // First get the paths to the markdown files from the repo using the GitHub API
  const docsUrl = new URL(
    `https://api.github.com/repos/${repo}/contents/${path}`,
  );
  const docsRes = await fetch(docsUrl.toString(), {
    headers: {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "astro",
    },
  });
  const docsJson = await docsRes.json();
  if (!Array.isArray(docsJson)) {
    throw new Error("Failed to fetch docs from GitHub");
  }
  const docsEntries = docsJson.map((entry) => ({
    selfUrl: entry.self,
    downloadUrl: entry.download_url,
  }));

  type Schema = {
    name: string;
    path: string;
    sha: string;
    size: number;
    url: string;
    html_url: string;
    git_url: string;
    download_url: string;
    type: string;
    content: string;
    encoding: string;
    _links: {
      self: string;
      git: string;
      html: string;
    };
  };

  // Now download the markdown files and parse them
  return {
    name: "ollama-docs-loader",
    schema: z.object({
      name: z.string(),
      path: z.string(),
      sha: z.string(),
      size: z.number(),
      url: z.string(),
      html_url: z.string(),
      git_url: z.string(),
      download_url: z.string(),
      type: z.string(),
      content: z.string(),
      encoding: z.string(),
      _links: z.object({
        self: z.string(),
        git: z.string(),
        html: z.string(),
      }),
    }),
    load: async (context: LoaderContext): Promise<void> => {
      const { store, parseData } = context;

      await Promise.all(
        docsEntries.map(async (entry) => {
          const { selfUrl, downloadUrl } = entry;

          // Fetch metadata
          const metadataRes = await fetch(selfUrl);
          if (!metadataRes.ok) {
            throw new Error(`Failed to fetch ${selfUrl}`);
          }
          const metadata = (await metadataRes.json()) as Schema;

          // Fetch content to overwrite the encoded content in the metadata
          const res = await fetch(downloadUrl);
          if (!res.ok) {
            throw new Error(`Failed to fetch ${downloadUrl}`);
          }
          const text = await res.text();
          if (!text) {
            throw new Error(`Failed to fetch ${downloadUrl}`);
          }

          // Parse the content
          const data = await parseData({
            id: metadata.url,
            data: {
              ...metadata,
              content: text,
            },
          });
          if (data) {
            store.set({ id: metadata.url, data });
          }
        }),
      );
    },
  };
}
