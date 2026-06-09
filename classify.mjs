const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
const token = process.env.REPL_IDENTITY
  ? `repl ${process.env.REPL_IDENTITY}`
  : process.env.WEB_REPL_RENEWAL
    ? `depl ${process.env.WEB_REPL_RENEWAL}`
    : null;
if (!hostname || !token) {
  console.error("Missing Replit connector environment.");
  process.exit(1);
}
const protocol = hostname.startsWith("localhost") ? "http" : "https";
const endpoint = `${protocol}://${hostname}/api/v2/proxy/admin/api/2026-04/graphql.json`;

async function admin(query, variables) {
  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Replit-Token": token,
      "Connector-Name": "shopify-store",
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(60000),
  });
  const j = await r.json();
  if (j.errors) throw new Error("GQL: " + JSON.stringify(j.errors));
  return j.data;
}

// legacyResourceId -> productType
const map = {
  "10500330586404": "Mens",
  "10500337172772": "Mens",
  "10500338778404": "Mens",
  "10500494393636": "Accessories",
  "10500511695140": "Accessories",
  "10500513661220": "Accessories",
  "10500309123364": "Casual Dresses",
  "10500333338916": "Casual Dresses",
  "10500504387876": "Casual Dresses",
  "10500354933028": "Beach",
  "10500375413028": "Beach",
  "10500404216100": "Beach",
  "10500533518628": "Beach",
  "10500381671716": "Cocktail Dresses",
  "10500537319716": "Cocktail Dresses",
  "10500544266532": "Cocktail Dresses",
  "10500508254500": "Evening Dresses",
  "10500398252324": "Tops",
  "10500508614948": "Tops",
  "10500329341220": "Sets",
  "10500391108900": "Sets",
  "10500394844452": "Sets",
};

const UPDATE = `mutation($input:ProductInput!){ productUpdate(input:$input){ product{ id productType } userErrors{ field message } } }`;

for (const [id, productType] of Object.entries(map)) {
  const d = await admin(UPDATE, { input: { id: `gid://shopify/Product/${id}`, productType } });
  const e = d.productUpdate.userErrors;
  if (e.length) throw new Error("update " + id + ": " + JSON.stringify(e));
  console.log("set", id, "->", productType);
}
console.log("DONE");
