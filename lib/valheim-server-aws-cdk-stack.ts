import * as cdk from "@aws-cdk/core";
import * as ec2 from "@aws-cdk/aws-ec2";
import * as ecs from "@aws-cdk/aws-ecs";
import * as secretsManager from "@aws-cdk/aws-secretsmanager";
import * as efs from "@aws-cdk/aws-efs";
import { validateCfnTag } from "@aws-cdk/core";
import { runInThisContext } from "vm";

export class ValheimServerAwsCdkStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // MUST BE DEFINED BEFORE RUNNING CDK DEPLOY! Key Value should be: VALHEIM_SERVER_PASS
    const valheimServerPass = secretsManager.Secret.fromSecretNameV2(
      this,
      "predefinedValheimServerPass",
      "valheimServerPass"
    );

    const vpc = new ec2.Vpc(this, "valheimVpc", {
      cidr: "10.0.0.0/24",
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "valheimPublicSubnet",
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
      maxAzs: 1,
    });

    const fargateCluster = new ecs.Cluster(this, "fargateCluster", {
      vpc: vpc,
      capacityProviders: ['FARGATE', 'FARGATE_SPOT']
    });

    const serverFileSystem = new efs.FileSystem(this, "valheimServerStorage", {
      vpc: vpc,
      encrypted: true,
    });

    const serverVolumeConfig: ecs.Volume = {
      name: "valheimServerVolume",
      efsVolumeConfiguration: {
        fileSystemId: serverFileSystem.fileSystemId,
      },
    };

    const mountPoint: ecs.MountPoint = {
      containerPath: "/config",
      sourceVolume: serverVolumeConfig.name,
      readOnly: false,
    };

    const valheimTaskDefinition = new ecs.TaskDefinition(
      this,
      "valheimTaskDefinition",
      {
        
        compatibility: ecs.Compatibility.FARGATE,
        cpu: "2048",
        memoryMiB: "4096",
        volumes: [serverVolumeConfig],
        networkMode: ecs.NetworkMode.AWS_VPC,
      }
    );
 
    const container = valheimTaskDefinition.addContainer("valheimContainer", {
      image: ecs.ContainerImage.fromRegistry("lloesche/valheim-server"),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "ValheimServer" }),
      stopTimeout: cdk.Duration.seconds(120),
      environment: {
        SERVER_NAME: "SWEEEEEENEY",
        SERVER_PORT: "2456",
        SERVER_PASS: "raven",
        WORLD_NAME: "Sweet",
        SERVER_PUBLIC: "1",
        UPDATE_INTERVAL: "900",
        BACKUPS_INTERVAL: "3600",
        BACKUPS_DIRECTORY: "/config/backups",
        BACKUPS_MAX_AGE: "3",
        BACKUPS_DIRECTORY_PERMISSIONS: "755",
        BACKUPS_FILE_PERMISSIONS: "755",
        CONFIG_DIRECTORY_PERMISSIONS: "755",
        WORLDS_DIRECTORY_PERMISSIONS: "755",
        WORLDS_FILE_PERMISSIONS: "755",
        DNS_1: "10.0.0.2",
        DNS_2: "10.0.0.2",
        STEAMCMD_ARGS: "validate",
      }
    });

    container.addPortMappings(
      {
        containerPort: 2456,
        hostPort: 2456,
        protocol: ecs.Protocol.UDP,
      },
      {
        containerPort: 2457,
        hostPort: 2457,
        protocol: ecs.Protocol.UDP,
      },
      {
        containerPort: 2458,
        hostPort: 2458,
        protocol: ecs.Protocol.UDP,
      }
    );

    container.addMountPoints(mountPoint);

    const valheimService = new ecs.FargateService(this, "valheimService", {
      
      cluster: fargateCluster,
      taskDefinition: valheimTaskDefinition,
      capacityProviderStrategies: [
        {
          capacityProvider: 'FARGATE_SPOT',
          weight: 4,
        },
        {
          capacityProvider: 'FARGATE',
          weight: 0,
        }
      ],
      desiredCount: 1,
      assignPublicIp: true,
      platformVersion: ecs.FargatePlatformVersion.VERSION1_4,
    });

    serverFileSystem.connections.allowDefaultPortFrom(valheimService);
    valheimService.connections.allowFromAnyIpv4(
      new ec2.Port({
        protocol: ec2.Protocol.UDP,
        stringRepresentation: "valheimPorts",
        fromPort: 2456,
        toPort: 2458,
      })
    );

    new cdk.CfnOutput(this, "serviceName", {
      value: valheimService.serviceName,
    });

    new cdk.CfnOutput(this, "clusterArn", {
      value: fargateCluster.clusterName
    });

    new cdk.CfnOutput(this, "EFSId", {
      value: serverFileSystem.fileSystemId
    })
  }
}
