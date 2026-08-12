import React from "react";
import { Redirect } from "@docusaurus/router";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";

// The site root leads straight into the docs, as upstream does.
export default function Home(): React.ReactElement {
  const { siteConfig } = useDocusaurusContext();
  return <Redirect to={`${siteConfig.baseUrl}docs`} />;
}
