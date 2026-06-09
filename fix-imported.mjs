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

const REPLIT_PUB = "gid://shopify/Publication/311804231972";
const ONLINE_PUB = "gid://shopify/Publication/311146512676";

// Retail markup applied to the supplier cost of imported products.
const MARKUP = 2.5;
// Tag that marks a product as already processed (priced + locked basis).
const PRICED_TAG = "emma-priced";

// The 3 hand-seeded dresses already have retail prices, so they are left alone.
const SEEDED = new Set(["Black Obsidian Gown", "Scarlet Velvet Column", "Rose Satin Wrap Dress"]);

const data = await admin(`query {
  products(first: 100) {
    nodes {
      id
      title
      tags
      variants(first: 1) {
        nodes {
          id
          price
          inventoryItem { id unitCost { amount } }
        }
      }
    }
  }
}`);

const targets = data.products.nodes.filter((p) => !SEEDED.has(p.title));
console.log("imported products to process:", targets.length);

for (const p of targets) {
  const variant = p.variants.nodes[0];
  const priced = p.tags.includes(PRICED_TAG);

  // Idempotency via the PRICED_TAG, NOT unitCost (the import tool fills unitCost
  // with unreliable values). On first pass the displayed price IS the supplier
  // cost, so we lock it into inventoryItem.cost and tag the product. From then on
  // the basis comes from that locked cost, so re-runs always yield cost*MARKUP and
  // never compound the markup.
  const basis = priced ? Number(variant.inventoryItem.unitCost?.amount) : Number(variant.price);
  const retail = Math.round(basis * MARKUP);

  const variantInput = {
    id: variant.id,
    price: String(retail),
    inventoryPolicy: "CONTINUE",
    inventoryItem: { tracked: false, cost: String(basis) },
  };

  const upd = await admin(
    `mutation ($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants { id price } userErrors { field message }
      }
    }`,
    { productId: p.id, variants: [variantInput] },
  );
  const e1 = upd.productVariantsBulkUpdate.userErrors;
  if (e1.length) throw new Error("variant update: " + JSON.stringify(e1));

  if (!priced) {
    const tag = await admin(
      `mutation ($id: ID!, $tags: [String!]!) {
        tagsAdd(id: $id, tags: $tags) { userErrors { field message } }
      }`,
      { id: p.id, tags: [PRICED_TAG] },
    );
    const e3 = tag.tagsAdd.userErrors;
    if (e3.length) throw new Error("tagsAdd: " + JSON.stringify(e3));
  }

  const pub = await admin(
    `mutation ($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) { userErrors { field message } }
    }`,
    { id: p.id, input: [{ publicationId: REPLIT_PUB }, { publicationId: ONLINE_PUB }] },
  );
  const e2 = pub.publishablePublish.userErrors;
  if (e2.length) throw new Error("publish: " + JSON.stringify(e2));

  console.log(`fixed: ${p.title.slice(0, 36)} | cost ${basis} -> ${retail}${priced ? " (reprice)" : ""}`);
}
console.log("done");
