#!/usr/bin/env node

/**
 * This should normally be run without any environment changes and will build, tag, and push 2 docker images for latest-rc
 * Should you ever need to manually run this script, then
 * 1. make sure you've logged into docker from its CLI `docker login`
 * 3. provide the version, example: SALESFORCE_CLI_VERSION=7.100.0 ./scripts/docker-publish
 * 4. you can add NO_PUBLISH=true if you want to only do local builds from the script
 */
const shell = require('shelljs');
const got = require('got');
const fs = require('fs-extra');
const dockerShared = require('./docker-shared');

shell.set('-e');
shell.set('+v');

const DOCKER_HUB_REPOSITORY = dockerShared.repo;

// look in the versions file, and if not, try the latest-rc buildmanifest (which doesn't hit the versions file until it's promoted to latest)
const getDownloadUrl = async (version) => {
  let { body } = await got(
    'https://developer.salesforce.com/media/salesforce-cli/sfdx/versions/sfdx-linux-x64-tar-xz.json',
    { responseType: 'json' }
  );
  if (body[version]) {
    console.log(`Found download URL ${body[version]} in versions file`);
    return body[version];
  }

  let rcResponse = await got(
    'https://developer.salesforce.com/media/salesforce-cli/sfdx/channels/stable-rc/sfdx-linux-x64-buildmanifest',
    { responseType: 'json' }
  );
  if (rcResponse.body.version === version && rcResponse.body.xz) {
    console.log(`Found download URL ${rcResponse.body.xz} in latest-rc build manifest`);
    return rcResponse.body.xz;
  }
  throw new Error(`could not find version ${version}`);
};

(async () => {
  dockerShared.validateDockerEnv();

  // If not in the env, read the package.json to get the version number we'll use for latest-rc
  const SALESFORCE_CLI_VERSION = process.env['SALESFORCE_CLI_VERSION'] ?? (await fs.readJson('package.json')).version;
  if (!SALESFORCE_CLI_VERSION) {
    shell.echo('No Salesforce CLI version was available.');
    shell.exit(-1);
  }
  shell.echo(`Using Salesforce CLI Version ${SALESFORCE_CLI_VERSION}`);

  const CLI_DOWNLOAD_URL = await getDownloadUrl(SALESFORCE_CLI_VERSION);

  // build from local dockerfiles
  /* SLIM VERSION */
  shell.exec(
    `docker build --file ./dockerfiles/Dockerfile_slim --build-arg DOWNLOAD_URL=${CLI_DOWNLOAD_URL} --tag ${DOCKER_HUB_REPOSITORY}:${SALESFORCE_CLI_VERSION}-slim --no-cache .`
  );
  /* FULL VERSION */
  shell.exec(
    `docker build --file ./dockerfiles/Dockerfile_full --build-arg SALESFORCE_CLI_VERSION=${SALESFORCE_CLI_VERSION} --tag ${DOCKER_HUB_REPOSITORY}:${SALESFORCE_CLI_VERSION}-full --no-cache .`
  );

  if (process.env.NO_PUBLISH) return;
  // Push to the Docker Hub Registry
  /* SLIM VERSION */
  shell.exec(`docker push ${DOCKER_HUB_REPOSITORY}:${SALESFORCE_CLI_VERSION}-slim`);
  /* FULL VERSION */
  shell.exec(`docker push ${DOCKER_HUB_REPOSITORY}:${SALESFORCE_CLI_VERSION}-full`);

  // This normally defaults to latest-rc.  If you've supplied it in the environment, we're not tagging latest-rc.
  if (process.env['SALESFORCE_CLI_VERSION']) return;
  // tag the newly created version as latest-rc
  shell.exec(
    `docker tag ${DOCKER_HUB_REPOSITORY}:${SALESFORCE_CLI_VERSION}-slim ${DOCKER_HUB_REPOSITORY}:latest-rc-slim`
  );
  shell.exec(`docker push ${DOCKER_HUB_REPOSITORY}:latest-rc-slim`);
  shell.exec(
    `docker tag ${DOCKER_HUB_REPOSITORY}:${SALESFORCE_CLI_VERSION}-full ${DOCKER_HUB_REPOSITORY}:latest-rc-full`
  );
  shell.exec(`docker push ${DOCKER_HUB_REPOSITORY}:latest-rc-full`);
})();
