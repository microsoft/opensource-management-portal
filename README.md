# Open Source Management Portal

**2025 note: this project does not entirely build today and is a partial reference implementation for example purposes only**

This application represents the home for open source engineering experiences
at Microsoft. As a backend application it manages source of truth for many
types of corporate open source metadata, historical intent of repos
and projects, hosts a rich front-end, and also a set of APIs used by partner
teams.

While we prefer native GitHub experiences, when it comes to displaying certain info
and being more transparent about permissions and metadata, especially on
GitHub, which has no extensible user interface, we end up using and driving
people to this Open Source Management Portal to get the information they
need.

At Microsoft, 70,000 engineers are using a version of this portal as part of
their open source engineering experience. However, Microsoft does have a set
of "company-specific" extensions, including a separate React frontend client,
that are not currently part of this repository. And... yup, if we were to
start over today, we'd probably make this a Next.js-or-similar project.

Core capabilities and features of this application:

- **Linking GitHub accounts ⛓️** for enterprise use
- **Self-service GitHub organization joining 🙋** for engineers
- **Creating and managing GitHub open source repositories 👩‍💻**
- **Displaying transparent information, metrics, and company-specific data** about our GitHub open source presence around permissions, access, metadata, intent, and especially cross-organization views and search indexes
- **People inventory 👨‍🦳🧑‍🚀🧒🏽** to help people connect GitHub public logins with corporate identities
- **Intercepting forks and new repositories 🔐** to inject compliance and approval processes
- **Disable and enable 🔑** experiences for GitHub repositories
- **Just-in-time (JIT) access 🚪** for open source repositories, teams, and organizations, aligning with the principle of least privilege access
- **Sudo ⚡️** capabilities for repos, teams, organizations to remove persistent broad ownership and admin permissions
- **Hosting APIs 🍽️** to create repos, large-scale orgs to access link data, and reports
- **Background jobs 👷‍♂️** to maintain eventual consistency, run tasks, gather metrics, and prepare OKRs
- **Team join requests/approvals with context 🚪** building beyond the GitHub experience
- **Automated offboarding 🛶** when people take on new opportunities

At Microsoft, additional capabilities include:

- **Pre-release business and legal approvals to release projects 🧑‍⚖️**
- **Requesting contribution reviews ✍🏾** within policy
- **Service Tree and Direct Owners inventory 🌳** for showing accountable ownership information for repos when available
- **Hosting internal docs 📚** at aka.ms/opensource
- **Hosting a subset of opensource.microsoft.com's APIs 🌍** to bring to life the Microsoft open source presence

The management portal is designed to be fast, efficient, and get out of the way of engineers
to get their important work done, with an emphasis on _relentless automation_ and _delegation_.

Most of the experience is eventually consistent; however, operational actions
such as joining teams, orgs, sudo operations, etc., are fully consistent at the time
they are requested.

## LICENSE

[MIT License](LICENSE)

## Contributing

This project welcomes contributions and suggestions. Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit <https://cla.opensource.microsoft.com>.

When you submit a pull request, a CLA bot will automatically determine whether you need to provide
a CLA and decorate the PR appropriately (e.g., status check, comment). Simply follow the instructions
provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
