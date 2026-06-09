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

// Map a product to its Shopify productType. The sync endpoint slugifies
// productType into the storefront category (e.g. "Casual Dresses" -> "casual-dresses").
function productTypeFor(title) {
  const t = title.toLowerCase();
  if (t.includes("bodycon")) return "Casual Dresses";
  if (t.includes("v-neck") || t.includes("v neck")) return "Cocktail Dresses";
  return null;
}

const data = await admin(`query {
  products(first: 100) { nodes { id title productType } }
}`);

for (const p of data.products.nodes) {
  const wanted = productTypeFor(p.title);
  if (!wanted || p.productType === wanted) continue;

  const upd = await admin(
    `mutation ($id: ID!, $type: String!) {
      productUpdate(input: { id: $id, productType: $type }) {
        product { id productType } userErrors { field message }
      }
    }`,
    { id: p.id, type: wanted },
  );
  const errs = upd.productUpdate.userErrors;
  if (errs.length) throw new Error("productUpdate: " + JSON.stringify(errs));
  console.log(`categorized: ${p.title.slice(0, 40)} -> ${wanted}`);
}
console.log("done");
