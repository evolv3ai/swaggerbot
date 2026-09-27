import { createFileRoute } from "@tanstack/react-router";
import { type KeyActions, KeysView } from "~/components/keys/keys-view";
import {
  createOwnKey,
  getKeysPage,
  revokeOwnKey,
  rollOwnKey,
} from "~/server/keys-page-fns";

const actions: KeyActions = {
  create: () => createOwnKey(),
  roll: () => rollOwnKey(),
  revoke: () => revokeOwnKey(),
};

export const Route = createFileRoute("/keys")({
  loader: () => getKeysPage(),
  // Who is signed in decides the page: read it afresh on every visit.
  staleTime: 0,
  gcTime: 0,
  head: () => ({
    meta: [
      { title: "Your API key · SwaggerBot" },
      {
        name: "description",
        content:
          "Get a SwaggerBot API key for Discovery and fresh Lookups: sign in, and it is issued at once. See today's credits, roll it or revoke it.",
      },
    ],
  }),
  component: Keys,
});

function Keys() {
  return <KeysView page={Route.useLoaderData()} actions={actions} />;
}
