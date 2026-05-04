import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

const username =
  process.env.GH_USERNAME ||
  process.env.GITHUB_REPOSITORY_OWNER ||
  'yashrajnayak';
const maxRepos = Number.parseInt(process.env.MAX_REPOS || '6', 10);
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const apiBase = process.env.GITHUB_API_URL || 'https://api.github.com';
const profileRepoName = process.env.PROFILE_REPO_NAME || username;
const excludedRepos = new Set(
  [profileRepoName, ...(process.env.EXCLUDED_REPOS || '').split(',')]
    .map((repo) => repo.trim())
    .filter(Boolean),
);

const startMarker = '<!-- TOP-REPOS:START -->';
const endMarker = '<!-- TOP-REPOS:END -->';

async function githubGet(path) {
  const response = await fetch(`${apiBase}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'top-starred-repos-readme-updater',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `GitHub API request failed: ${response.status} ${response.statusText}\n${body}`,
    );
  }

  return response.json();
}

async function fetchOwnedRepos() {
  const repos = [];

  for (let page = 1; ; page += 1) {
    const batch = await githubGet(
      `/users/${username}/repos?type=owner&sort=updated&direction=desc&per_page=100&page=${page}`,
    );

    repos.push(...batch);

    if (batch.length < 100) {
      break;
    }
  }

  return repos;
}

function publicPortfolioFields(repo) {
  return {
    name: repo.name,
    fullName: repo.full_name,
    description: repo.description || '',
    url: repo.html_url,
    homepage: repo.homepage || '',
    language: repo.language || '',
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    topics: repo.topics || [],
    updatedAt: repo.updated_at,
    pushedAt: repo.pushed_at,
  };
}

function escapeMarkdown(value) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function formatStars(value) {
  return new Intl.NumberFormat('en-US').format(value);
}

function buildMarkdown(repos) {
  if (repos.length === 0) {
    return 'No public repositories found yet.';
  }

  const rows = repos.map((repo) => {
    const description = repo.description || 'No description provided.';
    const language = repo.language || 'Mixed';

    return `| [${escapeMarkdown(repo.name)}](${repo.url}) | ${formatStars(repo.stars)} | ${escapeMarkdown(description)} | ${escapeMarkdown(language)} |`;
  });

  return [
    '| Repository | Stars | Description | Language |',
    '| --- | ---: | --- | --- |',
    ...rows,
  ].join('\n');
}

function updateReadmeSection(readme, markdown) {
  const start = readme.indexOf(startMarker);
  const end = readme.indexOf(endMarker);

  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `Could not find ${startMarker} and ${endMarker} markers in README.md`,
    );
  }

  return `${readme.slice(0, start + startMarker.length)}\n${markdown}\n${readme.slice(end)}`;
}

const repos = (await fetchOwnedRepos())
  .filter((repo) => !repo.fork)
  .filter((repo) => !repo.archived)
  .filter((repo) => !excludedRepos.has(repo.name))
  .sort((a, b) => {
    if (b.stargazers_count !== a.stargazers_count) {
      return b.stargazers_count - a.stargazers_count;
    }

    return new Date(b.pushed_at || b.updated_at) - new Date(a.pushed_at || a.updated_at);
  })
  .slice(0, maxRepos)
  .map(publicPortfolioFields);

const readmePath = join(repoRoot, 'README.md');
const dataPath = join(repoRoot, 'data', 'top-repos.json');

const readme = await readFile(readmePath, 'utf8');
const nextReadme = updateReadmeSection(readme, buildMarkdown(repos));

await mkdir(dirname(dataPath), { recursive: true });
await writeFile(readmePath, nextReadme, 'utf8');
await writeFile(dataPath, `${JSON.stringify(repos, null, 2)}\n`, 'utf8');

console.log(`Updated README.md and data/top-repos.json with ${repos.length} repositories.`);
