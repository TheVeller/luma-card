import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    // Luma events, templates and saved styles barely change within a session.
    // Defaulting to staleTime 0 made every tab focus and every re-mount refetch.
    defaultOptions: {
      queries: { staleTime: 5 * 60_000, refetchOnWindowFocus: false },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
