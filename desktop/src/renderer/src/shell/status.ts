import { createContext, useContext } from "react";

/**
 * How a view writes the status bar's left side (where its data came from, how
 * long it took) without the frame needing to know anything about the view.
 */
export const StatusContext = createContext<(text: string) => void>(() => {});

export const useSetStatus = () => useContext(StatusContext);
