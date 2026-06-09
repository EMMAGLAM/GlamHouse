const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
const token = process.env.REPL_IDENTITY
  ? `repl ${process.env.REPL_IDENTITY}`
  : process.env.WEB_REPL_RENEWAL
    ? `depl ${process.env.WEB_REPL_RENEWAL}`
    : null;
if (!hostname || !token) {
  console.error("Missing Replit connector environment. Run inside the Repl shell.");
  process.exit(1);
}
const protocol = hostname.startsWith("localhost") ? "http" : "https";

async function admin(query, variables) {
  const resp = await fetch(`${protocol}://${hostname}/api/v2/proxy/admin/api/2026-04/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Replit-Token": token,
      "Connector-Name": "shopify-store",
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = await resp.json();
  if (json.errors) throw new Error("GraphQL: " + JSON.stringify(json.errors));
  return json.data;
}

// The storefront marks a drop as featured when its Shopify product carries the
// "featured" tag (the sync derives drop.featured from this tag, so it survives re-syncs).
const data = await admin(`query { products(first: 100) { nodes { id title tags } } }`);

for (const p of data.products.nodes) {
  if (p.tags.includes("featured")) continue;
  const res = await admin(
    `mutation ($id: ID!, $tags: [String!]!) {
      tagsAdd(id: $id, tags: $tags) { userErrors { field message } }
    }`,
    { id: p.id, tags: ["featured"] },
  );
  const errs = res.tagsAdd.userErrors;
  if (errs.length) throw new Error("tagsAdd: " + JSON.stringify(errs));
  console.log(`featured: ${p.title.slice(0, 40)}`);
}
console.log("done");
