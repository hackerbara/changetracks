// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "ChangeDown",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "ChangeDown",
            path: "Sources/ChangeDownApp"
        ),
    ]
)
