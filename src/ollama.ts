import type { Loader, LoaderContext } from 'astro/loaders';
import { z } from 'zod';

export const docsSchema = z.object({
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
});

export async function ollamaDocsLoader(options: { repo: string; path: string }): Promise<Loader> {
  // Now download the markdown files and parse them
  return {
    name: 'ollama-docs-loader',
    schema: docsSchema,
    load: async (context: LoaderContext): Promise<void> => {
      const entries = await fetchDocsEntries(options);
      console.log(`ollamaDocsLoader: loading ${entries.length} entries`);

      await Promise.all(
        entries.map(async entry => {
          const data = await parseEntry(entry, context.parseData);

          if (data) {
            console.log(`ollamaDocsLoader: parsed ${data.url}`);
            context.store.set({ id: data.url, data });
          }
        }),
      );
    },
  };
}

async function fetchDocsEntries(options: {
  repo: string;
  path: string;
}): Promise<{ selfUrl: string; downloadUrl: string }[]> {
  const url = new URL(`https://api.github.com/repos/${options.repo}/contents/${options.path}`);

  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'astro',
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch ${options.repo}${options.path} from GitHub`);
  }

  const json = await res.json();
  if (!Array.isArray(json)) {
    throw new Error('Failed to fetch docs from GitHub');
  }

  const entries = json
    .map(entry => ({
      selfUrl: entry.url,
      downloadUrl: entry.download_url,
    }))
    .filter(
      entry =>
        entry.selfUrl &&
        entry.downloadUrl &&
        entry.downloadUrl.endsWith('.md') &&
        !entry.downloadUrl.includes('README.md'),
    );

  return entries;
}

async function parseEntry(
  entry: { selfUrl: string; downloadUrl: string },
  parser: LoaderContext['parseData'],
): Promise<z.infer<typeof docsSchema> | null> {
  const urls: Record<string, URL> = {};
  try {
    urls.selfUrl = new URL(entry.selfUrl);
    urls.downloadUrl = new URL(entry.downloadUrl);
  } catch (e) {
    return null;
  }
  const { selfUrl, downloadUrl } = urls;

  // Fetch metadata
  console.log(`ollamaDocsLoader: loading ${selfUrl}`);
  const metadataRes = await fetch(selfUrl);
  if (!metadataRes.ok) {
    throw new Error(`Failed to fetch ${selfUrl}`);
  }
  const metadata = (await metadataRes.json()) as z.infer<typeof docsSchema>;
  if (!metadata) {
    throw new Error(`Failed to fetch ${selfUrl}`);
  }
  console.log(`ollamaDocsLoader: loaded ${selfUrl}`);

  // Fetch content to overwrite the encoded content in the metadata
  console.log(`ollamaDocsLoader: loading ${downloadUrl}`);
  const res = await fetch(downloadUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${downloadUrl}`);
  }
  const text = await res.text();
  if (!text) {
    throw new Error(`Failed to fetch ${downloadUrl}`);
  }
  console.log(`ollamaDocsLoader: loaded ${downloadUrl}`);

  // Parse the content
  const data = await parser({
    id: metadata.url,
    data: {
      ...metadata,
      content: transformMarkdownLinks(text),
    },
  });
  return data;
}

/**
 * Transforms relative Markdown links to route paths with a "/docs/" prefix
 * @author Claude 3.7 Sonnet
 * @param markdownContent The Markdown content with links to transform
 * @returns The Markdown content with transformed links
 */
function transformMarkdownLinks(markdownContent: string): string {
  // Regex to match Markdown links: [text](URL)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;

  return markdownContent.replace(linkRegex, (match, text, url) => {
    // Only transform relative paths that are Markdown files
    if (url.startsWith('./') || url.startsWith('../')) {
      // Extract path and fragment (if any)
      const [path, fragment] = url.split('#');

      // Remove leading './' from the path
      let cleanPath = path;
      if (cleanPath.startsWith('./')) {
        cleanPath = cleanPath.substring(2);
      }

      // Handle '../' by removing the parent directory reference
      // This is a simplified approach; for more complex path handling consider a full path library
      if (cleanPath.startsWith('../')) {
        cleanPath = cleanPath.substring(3); // Remove '../'
      }

      // Build the new URL with '/docs/' prefix
      const newUrl = `/docs/${cleanPath}${fragment ? '#' + fragment : ''}`;

      // Return the transformed link
      return `[${text}](${newUrl})`;
    }

    // Return unchanged if it's not a relative Markdown link
    return match;
  });
}
