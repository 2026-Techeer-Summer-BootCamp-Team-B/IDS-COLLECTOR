import React, { createContext, useContext } from "react";
const TabActivityContext = createContext(true);
export function TabActivityProvider({ active, children }) { return <TabActivityContext.Provider value={active}>{children}</TabActivityContext.Provider>; }
export const useTabActive = () => useContext(TabActivityContext);
