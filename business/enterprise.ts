//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { IProviders } from '../interfaces';

// TODO: paginate across enterprise fix + support iterators

export type EnterpriseSamlExternalIdentityBasics = {
  id: string;
  user: {
    login: string;
  };
  samlIdentity: {
    nameId: string;
  };
};

export type EnterpriseSamlExternalIdentityNode = {
  node: EnterpriseSamlExternalIdentityBasics;
};

export default class GitHubEnterprise {
  constructor(
    private providers: IProviders,
    public slug: string,
    private administrativeToken: string
  ) {}

  async getGitHubLoginForUserPrincipalName(userPrincipalName: string): Promise<string> {
    const node = await this.getSamlNodeFromUserPrincipalName(userPrincipalName);
    return node?.user?.login;
  }

  async getSamlNodeFromUserPrincipalName(
    userPrincipalName: string
  ): Promise<EnterpriseSamlExternalIdentityBasics> {
    const github = this.providers.github;
    try {
      const response = await github.graphql(
        this.administrativeToken,
        queries.getIdentityFromExternal,
        {
          enterpriseName: this.slug,
          userPrincipalName,
        },
        {
          paginate: false,
        }
      );
      const nodes = response?.enterprise?.ownerInfo?.samlIdentityProvider?.externalIdentities
        ?.edges as EnterpriseSamlExternalIdentityNode[];
      if (nodes.length > 0) {
        return nodes[0].node;
      }
    } catch (error) {
      throw error;
    }
  }

  async getSamlUserPrincipalNameForGitHubLogin(login: string): Promise<string> {
    const node = await this.getSamlNodeForGitHubLogin(login);
    return node?.samlIdentity?.nameId;
  }

  async getSamlNodeForGitHubLogin(login: string): Promise<EnterpriseSamlExternalIdentityBasics> {
    const github = this.providers.github;
    try {
      const response = await github.graphql(
        this.administrativeToken,
        queries.getIdentityFromGitHubLogin,
        {
          enterpriseName: this.slug,
          login,
        },
        {
          paginate: false,
        }
      );
      const nodes = response?.enterprise?.ownerInfo?.samlIdentityProvider?.externalIdentities
        ?.edges as EnterpriseSamlExternalIdentityNode[];
      if (nodes.length > 0) {
        return nodes[0].node;
      }
    } catch (error) {
      throw error;
    }
  }

  async getSamlMemberExternalIdentities(): Promise<EnterpriseSamlExternalIdentityBasics[]> {
    const fixedFirstFieldsCount = 8;
    const github = this.providers.github;
    try {
      const response = await github.graphql(
        this.administrativeToken,
        queries.paginate,
        {
          enterpriseName: this.slug,
          // id: this._id,
        },
        {
          paginate: false, // true,
        }
      );
      const nodes = response?.enterprise?.ownerInfo?.samlIdentityProvider?.externalIdentities
        ?.edges as EnterpriseSamlExternalIdentityNode[];
      return nodes.map((node) => node.node);
    } catch (error) {
      throw error;
    }
  }
}

const queries = {
  getIdentityFromGitHubLogin: `
    query getIdentity($enterpriseName: String!, $login: String!) {
      enterprise(slug: $enterpriseName) {
        ownerInfo {
          samlIdentityProvider {
            externalIdentities(first: 5, login: $login) {
              pageInfo {
                hasNextPage
                endCursor
              }
              edges {
                node {
                  user {
                    login
                  }
                  samlIdentity {
                    nameId
                  }
                }
              }
            }
          }
        }
      }
    }
  `,
  getIdentityFromExternal: `
    query getIdentity($enterpriseName: String!, $userPrincipalName: String!) {
      enterprise(slug: $enterpriseName) {
        ownerInfo {
          samlIdentityProvider {
            externalIdentities(first: 5, userName: $userPrincipalName) {
              pageInfo {
                hasNextPage
                endCursor
              }
              edges {
                node {
                  user {
                    login
                  }
                  samlIdentity {
                    nameId
                  }
                }
              }
            }
          }
        }
      }
    }
  `,
  paginate: `
    query paginate($cursor: String, $enterpriseName: String!) {
      enterprise(slug: $enterpriseName) {
        ownerInfo {
          samlIdentityProvider {
            externalIdentities(after: $cursor, first: 100) {
              pageInfo {
                hasNextPage
                endCursor
              }
              edges {
                node {
                  user {
                    login
                  }
                  samlIdentity {
                    nameId
                  }
                }
              }
            }
          }
        }
      }
    }
  `,
};
