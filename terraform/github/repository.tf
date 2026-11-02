resource "github_repository" "cronista" {
  name       = "Cronista"
  visibility = "public"

  # Squash only: each commit on master is one PR, and its title and body come from that PR.
  allow_squash_merge          = true
  allow_merge_commit          = false
  allow_rebase_merge          = false
  squash_merge_commit_title   = "PR_TITLE"
  squash_merge_commit_message = "PR_BODY"
  # Only the owner merges.
  allow_auto_merge       = false
  allow_update_branch    = true
  delete_branch_on_merge = true

  has_issues      = true
  has_projects    = false
  has_wiki        = false
  has_discussions = false

  security_and_analysis {
    secret_scanning {
      status = "enabled"
    }
    secret_scanning_push_protection {
      status = "enabled"
    }
  }

  # Removing this resource by mistake archives the repo instead of deleting it.
  archive_on_destroy = true

  lifecycle {
    prevent_destroy = true
  }
}

resource "github_repository_vulnerability_alerts" "cronista" {
  repository = github_repository.cronista.name
}
