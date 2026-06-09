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

const data = await admin(`query { products(first: 100) { nodes { id title } } }`);

for (const p of data.products.nodes) {
  if (!p.title.includes("2025")) continue;
  const newTitle = p.title.replace(/\s*2025\s*/g, " ").replace(/\s{2,}/g, " ").trim();
  const res = await admin(
    `mutation ($id: ID!, $title: String!) {
      productUpdate(input: { id: $id, title: $title }) {
        product { id title } userErrors { field message }
      }
    }`,
    { id: p.id, title: newTitle },
  );
  const errs = res.productUpdate.userErrors;
  if (errs.length) throw new Error("productUpdate: " + JSON.stringify(errs));
  console.log(`retitled -> ${newTitle.slice(0, 60)}`);
}
console.log("done");
