const CATEGORY_CONFIG = [
  { slug: "basketball", title: "Basketball", image: "/mut.st/images/mut_logo.svg" },
  { slug: "american-football", title: "American Football", image: "/mut.st/images/mut_logo.svg" },
  { slug: "football", title: "Football", image: "/mut.st/images/mut_logo.svg" },
  { slug: "hockey", title: "Hockey", image: "/mut.st/images/mut_logo.svg" },
  { slug: "baseball", title: "Baseball", image: "/mut.st/images/mut_logo.svg" },
  { slug: "fight", title: "Fight Streams", image: "/mut.st/images/mut_logo.svg" },
  { slug: "motor-sports", title: "Motor Sports", image: "/mut.st/images/mut_logo.svg" },
  { slug: "other", title: "Other Sports", image: "/mut.st/images/mut_logo.svg" }
];

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function normalizeTitle(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCategoryStreams(html, category) {
  const streams = [];
  const pattern =
    /<a href="([^"]+)" class="stream-link">[\s\S]*?<h3 class="stream-title">([\s\S]*?)<\/h3>[\s\S]*?(?:<span>([^<]*)<\/span>)?[\s\S]*?<\/a>/g;

  let match;
  while ((match = pattern.exec(html)) && streams.length < 24) {
    const href = match[1];
    const title = normalizeTitle(match[2]);
    const time = normalizeTitle(match[3] || "");

    if (!href || !title) {
      continue;
    }

    streams.push({
      title,
      time,
      url: href.replace(/^\.\.\//, "/mut.st/"),
      image: category.image
    });
  }

  return streams;
}

async function loadCategory(origin, category) {
  const categoryUrl = new URL(`/mut.st/category/${category.slug}.html`, origin);
  const response = await fetch(categoryUrl.toString());

  if (!response.ok) {
    throw new Error(`Failed to load ${category.slug}: ${response.status}`);
  }

  const html = await response.text();
  return {
    title: category.title,
    streams: parseCategoryStreams(html, category)
  };
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

export async function onRequestGet(context) {
  const { request, params } = context;
  const origin = new URL(request.url).origin;
  const categorySlug = Array.isArray(params.path) ? params.path[0] : params.path;

  try {
    if (categorySlug) {
      const category = CATEGORY_CONFIG.find((entry) => entry.slug === categorySlug);
      if (!category) {
        return json({ error: "Unknown sports category" }, 404);
      }

      const section = await loadCategory(origin, category);
      return json([section]);
    }

    const sections = [];
    for (const category of CATEGORY_CONFIG) {
      const section = await loadCategory(origin, category);
      if (section.streams.length > 0) {
        sections.push(section);
      }
    }

    return json(sections);
  } catch (error) {
    return json(
      {
        error: "Failed to load sports streams",
        detail: error instanceof Error ? error.message : String(error)
      },
      500
    );
  }
}
