import React from "react";
import { Redirect } from "@docusaurus/router";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";

// The bare URL opens the Skills Hub; docs are one click away in the nav.
export default function Home(): React.ReactElement {
  const { siteConfig } = useDocusaurusContext();
  return <Redirect to={`${siteConfig.baseUrl}hub/`} />;
}
