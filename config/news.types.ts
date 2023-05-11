//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigRootNews = {
  news: ConfigNews;
};

export type ConfigNewsArticleAction = {
  text: string;
  link: string;
};

export type ConfigNewsArticle = {
  title: string;
  subtitle: string;
  ignore: boolean;
  paragraphs: string[];
  actions: ConfigNewsArticleAction[];
};

export type ConfigNews = {
  all: ConfigNewsArticle[];
  homepage: ConfigNewsArticle[];
};
