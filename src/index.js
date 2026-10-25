export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const PROJECT_ID = env.FIREBASE_PROJECT_ID;

    // তোমার আগের sitemap.xml কে Worker টাচ করবে না
    // তাই ওইটার কোড এখানে রাখি নাই
    // ওটা Firebase Hosting থেকেই আসবে আগের মতো

    // 1. PRODUCT INDEX - https://ghotimarket.com/product-sitemap.xml
    // বট এখানে ভিজিট করলে তখন প্রোডাক্টের লিস্ট দিবে
    if (url.pathname === "/product-sitemap.xml") {
      let totalSitemaps = 20; // 10 লাখ / 50,000
      let xml = `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;
      for (let i = 1; i <= totalSitemaps; i++) {
        xml += `<sitemap><loc>https://ghotimarket.com/sitemap-products-${i}.xml</loc></sitemap>`;
      }
      xml += `</sitemapindex>`;
      return new Response(xml, { 
        headers: { "Content-Type": "application/xml", "Cache-Control": "public, max-age=3600" } 
      });
    }

    // 2. PRODUCTS FILES - https://ghotimarket.com/sitemap-products-1.xml
    if (url.pathname.startsWith("/sitemap-products-")) {
      const match = url.pathname.match(/sitemap-products-(\d+)\.xml/);
      if (!match) return new Response("Not found", { status: 404 });
      
      let num = parseInt(match[1]);
      const perBatch = 1000;
      const totalNeeded = 50000;

      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      ctx.waitUntil((async () => {
        try {
          await writer.write(encoder.encode(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`));
          for (let offset = 0; offset < totalNeeded; offset += perBatch) {
            const products = await getProductsFromFirebase(PROJECT_ID, num, offset, perBatch);
            if (products.length === 0) break;
            for (let p of products) {
              const line = `<url><loc>https://ghotimarket.com/product?${escapeXml(p.slug)}</loc><lastmod>${p.createdAt}</lastmod><priority>0.7</priority></url>`;
              await writer.write(encoder.encode(line));
            }
          }
          await writer.write(encoder.encode(`</urlset>`));
        } catch (e) {
          await writer.write(encoder.encode(`</urlset>`));
        } finally {
          await writer.close();
        }
      })());

      return new Response(readable, {
        headers: { "Content-Type": "application/xml", "Cache-Control": "public, max-age=21600" }
      });
    }

    // বাকি সব কিছু (sitemap.xml, home page) আগের মতোই চলবে
    return fetch(request);
  }
}

async function getProductsFromFirebase(projectId, sitemapNum, offset, limit) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "products" }],
        select: { fields: [{ fieldPath: "slug" }, { fieldPath: "createdAt" }] },
        orderBy: [{ field: { fieldPath: "__name__" } }],
        limit: limit,
        offset: (sitemapNum - 1) * 50000 + offset
      }
    })
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.filter(d => d.document?.fields?.slug).map(d => ({
    slug: d.document.fields.slug.stringValue,
    createdAt: d.document.fields.createdAt?.timestampValue || new Date().toISOString()
  }));
}

function escapeXml(unsafe) {
  return unsafe.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}
