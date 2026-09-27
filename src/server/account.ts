import { createServerFn } from "@tanstack/react-start";

/**
 * What the top bar shows of sign-in: nothing when it is off, "Sign in" when
 * no one is signed in, and the signed-in person's initial and menu.
 */
export type ShellAccount =
  | { signIn: "off" }
  | { signIn: "signed-out" }
  | { signIn: "signed-in"; name: string; email: string };

/**
 * The shell's account, read on the server from the request's session.
 * Server-only modules are imported inside the handler, keeping them out of
 * the client bundle.
 */
export const getShellAccount = createServerFn({ method: "GET" }).handler(
  async (): Promise<ShellAccount> => {
    const { currentUser, signInConfigured } = await import("./auth");
    if (!signInConfigured()) return { signIn: "off" };
    const user = currentUser();
    if (!user) return { signIn: "signed-out" };
    return {
      signIn: "signed-in",
      name: user.name ?? user.email,
      email: user.email,
    };
  },
);
