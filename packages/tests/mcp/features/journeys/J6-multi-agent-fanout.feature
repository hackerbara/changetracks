@J6 @wip
Feature: Multi-agent fan-out via MCP resources

  Background:
    Given a running changedown-mcp host on port 39990
    And a Word pane has registered session "sess-test-001"

  Scenario: J6.1 resources/list exposes the Word session
    When agent "ai:cursor" sends resources/list
    Then the response contains a resource with uri "word://sess-test-001"
    And the resource mimeType is "text/markdown"

  Scenario: J6.2 resources/list includes recently-accessed file
    Given agent "ai:cursor" has read "doc.md" via read_tracked_file
    When agent "ai:cursor" sends resources/list
    Then the response contains a resource whose uri ends with "doc.md"

  Scenario: J6.3 pane disconnect removes resource
    When the Word pane disconnects from session "sess-test-001"
    And agent "ai:cursor" sends resources/list after 6 seconds
    Then the response does not contain any resource with uri "word://sess-test-001"

  Scenario: J6.4 resources/read returns current hash-lined markdown
    When agent "ai:cursor" sends resources/read for uri "word://sess-test-001"
    Then the response contents[0].text contains hash-lined markdown

  Scenario: J6.5 two agents propose overlapping edits — TickQueue serializes, second sees first
    Given agent "ai:agent-a" proposes changing "REST" to "GraphQL" in "doc.md"
    When agent "ai:agent-b" concurrently proposes changing "REST" to "gRPC" in "doc.md"
    Then exactly one of the proposals lands as cn-1
    And the other proposal either errors or is recorded as superseding cn-1

  Scenario: J6.6 agent A subscribed; agent B edits; agent A receives notification
    Given agent "ai:agent-a" is subscribed to "word://sess-test-001"
    When agent "ai:agent-b" calls propose_change on the Word document
    Then agent "ai:agent-a" receives a "notifications/resources/updated" event
    And the event arrives before agent B's tool call response is returned

  Scenario: J6.7 PERMISSIVE review — agent B approves agent A's change
    Given agent "ai:agent-a" has proposed change "cn-1" in "doc.md"
    When agent "ai:agent-b" calls review_changes with decision approve for "cn-1"
    Then the review succeeds with status_updated true
    And no author-mismatch error is returned
