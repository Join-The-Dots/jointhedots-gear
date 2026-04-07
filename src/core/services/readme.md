# Services

## Purpose

Services define a specification of a elementary feature, that allow to separate a component exposure into a set of standardized features.

Service has for goal to be able to expose and consume safely feature between component, it shall the barebone of the runtime composition framework.

Service is mainly a interface management framework.

Service is a variadic interface, so a service is defined by the general specification which is associate to hyperparameters that allow to produce specialization of interface. Ex: a react service is define in typescript by 'React.ComponentType<P>' with P as a attribut defined later by service consumer and service providers.

## Service point

It's a global service connection point used to separated the consuming of a service defined at compile time from the providing of the service defined a runtime by user configuration.

## Service definition

It's the implementation of the checking rule that match compatibility between consumer and producer, and allow to filter for a given consumer what producer can be selected from the component library.

# Component

## Purpose

Component is the implementation side of services.

Component define what services they manage, and their specialization into these services.


