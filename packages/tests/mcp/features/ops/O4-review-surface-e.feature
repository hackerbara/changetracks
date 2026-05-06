Feature: Review changes via Surface E (decided view)
  As an AI agent reviewing from the decided view
  I want to see the clean document, identify changes by their markers,
  then approve/reject using the same review_changes tool

  Background:
    Given a tracked file with pending changes visible in decided view as [P] markers
    And the config has hashline.enabled = true

  Scenario: Read decided view shows change markers for review
    When I call read_tracked_file with view = "decided"
    Then pending changes appear with [P] line annotations
    And accepted changes appear with [A] line annotations
    And the text shows the reverted (original) content for pending items

  Scenario: Identify change from decided view then approve
    When I call read_tracked_file with view = "decided"
    And I identify cn-1 from the [P] marker
    And I call get_change for cn-1 to see full context
    And I call review_changes approving cn-1
    Then cn-1 is approved
    And a subsequent decided view read shows cn-1 text as accepted (no [P] marker)

  Scenario: Auto-settlement after approval in decided view
    Given the config has settlement.auto_on_approve = true
    When I approve cn-1 via review_changes
    Then the inline CriticMarkup for cn-1 is removed (settled)
    And the footnote status is "accepted"
    And the footnote persists (Layer 1 only)
    And subsequent reads show clean text at that location
