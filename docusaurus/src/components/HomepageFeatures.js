import React from "react";
import clsx from "clsx";
import styles from "./HomepageFeatures.module.css";

const FeatureList = [
  {
    title: "Easier Development",
    description: (
      <>
        Code, publish, and test all your packages using local sources without
        skipping a beat.
      </>
    ),
  },
  {
    title: "Integrated Local Package Install",
    description: (
      <>
        No symlink magic, no dependencies hoisting, no package mixing, no
        hacking npm dependency graph.
      </>
    ),
  },
  {
    title: "Freedom and Flexibility",
    description: (
      <>
        Develop and test with local packages outside of your monorepo directly
      </>
    ),
  },
  {
    title: "npm workflow",
    description: (
      <>
        Designed from the ground up to enable a monorepo that integrates with
        the standard npm workflow
      </>
    ),
  },
  {
    title: "Independent Applications",
    description: (
      <>
        Applications are not confined to the monorepo. You can zip up, copy, or
        deploy an application from the monorepo and it just works.
      </>
    ),
  },
  {
    title: "Hybrid Publish Mode",
    description: (
      <>
        You can lock versions of some selected packages and leave others as
        independent in the same monorepo
      </>
    ),
  },
  {
    title: "Automated Releasing",
    description: (
      <>
        Using git commit messages as source, fynpo help you automatically update
        CHANGELOG and package versions, and then publish them.
      </>
    ),
  },
  {
    title: "Incremental Builds",
    description: (
      <>
        Generate cache using files and data from custom or npm rules to avoid
        running the same build for packages multiple times.
      </>
    ),
  },
  {
    title: "Remote Caching",
    description: (
      <>Upload cache to remote server to share with others and CI/CD jobs</>
    ),
  },
];

function Feature({ title, description }) {
  return (
    <div className={clsx("col col--4 padding-vert--md")}>
      <div className="text--center padding-horiz--md">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures() {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
